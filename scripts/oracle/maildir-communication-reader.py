#!/usr/bin/env python3
"""Read-only fixed-mailbox Maildir scanner for the trusted local broker.

No SMTP/IMAP passwords, arbitrary file paths, shell execution or tenant input.
The worker resolves and authorises mailbox ownership from SQL independently.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from email import policy
from email.parser import BytesParser

ADDRESS = re.compile(r"[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9][a-z0-9.-]{0,251}\Z")
PAGE = 4
MAX_RAW = 32 * 1024 * 1024
MAX_BODY = 8000
MAX_FILES = 20000


def mailbox_directory(address, mounts):
    domain, local = address.split("@", 1)[1], address.split("@", 1)[0]
    sources = [m.get("Source", "") for m in mounts
               if m.get("Destination") == "/var/mail" and m.get("Type") == "bind"]
    if len(sources) != 1:
        raise RuntimeError("Maildir volume unavailable")
    root = os.path.realpath(sources[0])
    for relative in (os.path.join(domain, local), os.path.join(domain, local, "Maildir")):
        directory = os.path.realpath(os.path.join(root, relative))
        if os.path.commonpath((root, directory)) != root:
            continue
        if all(os.path.isdir(os.path.join(directory, d)) for d in ("new", "cur")):
            return directory
    raise RuntimeError("Mailbox Maildir unavailable")



# The service broker is sandboxed with ProtectHome. When Docker Mailserver
# stores its bind mount under an inaccessible host home, read only the same
# mailbox inside the named container through fixed, argument-only Docker exec.
# Never use a shell or arbitrary caller-supplied paths/containers.
CONTAINER = "metadrive-docker-mailserver"
def docker_exec(args, timeout=7):
    return subprocess.run(
        ["/usr/bin/docker", "exec", CONTAINER, *args],
        capture_output=True, timeout=timeout, check=True,
        env={"PATH": "/usr/bin:/bin"}
    ).stdout

def container_directory(address):
    local, domain = address.split("@", 1)
    for suffix in ("", "/Maildir"):
        directory = "/var/mail/" + domain + "/" + local + suffix
        if all(subprocess.run(
            ["/usr/bin/docker", "exec", CONTAINER, "/usr/bin/test", "-d",
             directory + "/" + folder],
            capture_output=True, timeout=5,
            env={"PATH": "/usr/bin:/bin"}
        ).returncode == 0 for folder in ("new", "cur")):
            return "docker:" + directory
    raise RuntimeError("Mailbox directory not found in container")

def container_files(directory):
    root = directory.removeprefix("docker:")
    raw = docker_exec(
        ["/usr/bin/find", root+"/new", root+"/cur", "-maxdepth", "1",
         "-type", "f", "-size", "-33554433c",
         "-printf", r"%T@\t%p\0"], timeout=12)
    names = []
    for entry in raw.split(b"\0"):
        if not entry: continue
        try:
            timestamp, path = entry.split(b"\t", 1)
            filename = os.path.basename(os.fsdecode(path))
            fullpath = os.fsdecode(path)
            if not re.fullmatch(r"[A-Za-z0-9._,:+-]{1,255}", filename):
                continue
            if os.path.dirname(fullpath) not in (root+"/new", root+"/cur"):
                continue
            names.append((int(float(timestamp)*1_000_000_000), fullpath))
            if len(names)>MAX_FILES:
                raise RuntimeError("Maildir scan bound exceeded")
        except (ValueError, UnicodeError):
            continue
    return names


def extract_body(message):
    parts = message.walk() if message.is_multipart() else [message]
    text, html = [], []
    for part in parts:
        if part.is_multipart() or part.get_content_disposition() == "attachment":
            continue
        if part.get_content_type() not in ("text/plain", "text/html"):
            continue
        try:
            value = part.get_content()
        except (UnicodeError, ValueError, LookupError):
            continue
        if not isinstance(value, str):
            continue
        if part.get_content_type() == "text/plain":
            text.append(value)
        else:
            # HTML mail with no plain-text counterpart: strip markup safely.
            from html.parser import HTMLParser
            class Plain(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.values = []
                    self.skip = 0
                def handle_starttag(self, tag, attrs):
                    if tag in ("script", "style"):
                        self.skip += 1
                    elif tag in ("p", "br", "div", "li"):
                        self.values.append("\n")
                def handle_endtag(self, tag):
                    if tag in ("script", "style"):
                        self.skip = max(0, self.skip-1)
                def handle_data(self, data):
                    if not self.skip:
                        self.values.append(data)
            parser = Plain()
            parser.feed(value)
            html.append("".join(parser.values))
    return "\n".join(text or html)[:MAX_BODY]


def read_page(directory, offset):
    files = []
    if directory.startswith("docker:"):
        files = container_files(directory)
    else:
        for folder in ("new", "cur"):
            subdir = os.path.join(directory, folder)
            with os.scandir(subdir) as entries:
                for entry in entries:
                    if not entry.is_file(follow_symlinks=False):
                        continue
                    try:
                        stat = entry.stat(follow_symlinks=False)
                    except FileNotFoundError:
                        continue
                    if stat.st_size <= 0 or stat.st_size > MAX_RAW:
                        continue
                    files.append((stat.st_mtime_ns, entry.path))
                    if len(files) > MAX_FILES:
                        raise RuntimeError("Maildir exceeds scan safety limit")
    files.sort(key=lambda x: (x[0], x[1]), reverse=True)
    selection = files[offset:offset + PAGE]
    messages = []
    for timestamp, path in selection:
        try:
            if directory.startswith("docker:"):
                raw = docker_exec(["/usr/bin/cat", path], timeout=8)
            else:
                with open(path, "rb") as source:
                    raw = source.read(MAX_RAW + 1)
            if len(raw) > MAX_RAW:
                continue
            msg = BytesParser(policy=policy.default).parsebytes(raw)
            messages.append({
                "fingerprint": hashlib.sha256(raw).hexdigest(),
                "messageId": str(msg.get("Message-ID", ""))[:500],
                "from": str(msg.get("From", ""))[:500],
                "to": str(msg.get("To", ""))[:500],
                "subject": str(msg.get("Subject", ""))[:500],
                "body": extract_body(msg),
                "receivedAt": __import__("datetime").datetime.fromtimestamp(
                    timestamp / 1e9, __import__("datetime").timezone.utc).isoformat(),
            })
        except (OSError, ValueError, UnicodeError):
            continue
    return {"messages": messages, "nextOffset": offset + len(selection)
            if offset + len(selection) < len(files) else 0, "total": len(files)}


def main():
    if len(sys.argv) != 3:
        raise ValueError("Invalid scanner arguments")
    address = sys.argv[1]
    if not ADDRESS.fullmatch(address):
        raise ValueError("Invalid mailbox")
    offset = int(sys.argv[2])
    if not 0 <= offset <= MAX_FILES:
        raise ValueError("Invalid scan offset")
    output = subprocess.run(
        ["/usr/bin/docker", "inspect", "--format", "{{json .Mounts}}",
         "metadrive-docker-mailserver"], capture_output=True, text=True,
        timeout=6, check=True, env={"PATH": "/usr/bin:/bin"}
    )
    try:
        directory = mailbox_directory(address, json.loads(output.stdout))
    except (RuntimeError, OSError, ValueError):
        directory = container_directory(address)
    print(json.dumps(read_page(directory, offset), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"error": "Mailbox scanning unavailable"}))
        sys.exit(1)
