#!/usr/bin/env python3
"""Production read-only broker preflight. Never prints email contents."""
import json
import socket
import sys

def main():
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(53)
    sock.connect("/run/metadrive-mcp-broker.sock")
    sock.sendall((json.dumps({"action":"mailbox_scan","service":"worker",
        "address":"support@unesolutions.co.uk","offset":0})+"\n").encode())
    sock.shutdown(socket.SHUT_WR)
    payload = bytearray()
    while b"\n" not in payload:
        chunk = sock.recv(65536)
        if not chunk:
            raise RuntimeError("Mail broker disconnected")
        payload.extend(chunk)
        if len(payload)>115000:
            raise RuntimeError("Oversized mail broker response")
    sock.close()
    packet=json.loads(payload.split(b"\n",1)[0])
    if "error" in packet: raise RuntimeError("Inbound Maildir broker not ready")
    result=json.loads(packet["output"])
    if not isinstance(result.get("messages"),list) or not isinstance(result.get("total"),int):
        raise RuntimeError("Invalid Maildir broker response")
    print("Inbound Email Maildir scan ready (message contents withheld)")

if __name__=="__main__":
    try:
        main()
    except Exception:
        print("Inbound Email Maildir scan not ready",file=sys.stderr)
        sys.exit(1)
