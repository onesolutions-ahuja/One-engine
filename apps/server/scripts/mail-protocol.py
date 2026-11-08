#!/usr/bin/env python3
"""Restricted mailbox protocol worker: reads JSON from stdin, never CLI secrets."""
import base64,email,imaplib,json,re,smtplib,ssl,sys,time
from email import policy
from email.message import EmailMessage
from email.utils import make_msgid
class MailDeliveryError(Exception): pass
from html.parser import HTMLParser
class PlainHTML(HTMLParser):
 def __init__(self):
  super().__init__();self.text=[];self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style'): self.skip+=1
  elif tag in ('p','br','li','div'): self.text.append('\n')
 def handle_endtag(self,tag):
  if tag in ('script','style'): self.skip=max(0,self.skip-1)
 def handle_data(self,value):
  if not self.skip: self.text.append(value)

# A LIST row contains FLAGS, a DELIMITER and then the mailbox name.
# The name can be a quoted string or an unquoted atom; split(' "') mistakes
# the quoted delimiter for the name on responses like: (\HasNoChildren) "/" INBOX.
_LIST_ROW=re.compile(rb'^\s*\(([^)]*)\)\s+(?:"(?:\\.|[^"\\])*"|NIL)\s+("(?:\\.|[^"\\])*"|[^\s]+)\s*$',re.I)
_LIST_LITERAL=re.compile(rb'^\s*\(([^)]*)\)\s+(?:"(?:\\.|[^"\\])*"|NIL)\s+\{\d+\}\s*$',re.I)
def parse_imap_folders(rows):
 folders=[]
 for row in rows or []:
  literal=None
  if isinstance(row,tuple):
   if len(row)!=2 or not isinstance(row[0],bytes) or not isinstance(row[1],bytes): continue
   match=_LIST_LITERAL.fullmatch(row[0])
   if not match: continue
   flags=match.group(1);literal=row[1]
  else:
   if not isinstance(row,bytes): continue
   match=_LIST_ROW.fullmatch(row)
   if not match: continue
   flags=match.group(1)
  if b'\\noselect' in flags.lower(): continue
  name=literal if literal is not None else match.group(2)
  if name.upper()==b'NIL': continue
  if literal is None and name.startswith(b'"'):
   name=re.sub(rb'\\(.)',lambda m:m.group(1),name[1:-1])
  decoded=name.decode('utf8','replace')
  if not decoded or len(decoded)>200 or any(ch in decoded for ch in '\r\n\0'): continue
  folders.append({'id':decoded,'name':decoded})
 return folders

def imap_mailbox_arg(folder):
 # imaplib does not quote SELECT arguments automatically.
 return '"' + folder.replace('\\','\\\\').replace('"','\\"') + '"'

MAX=32*1024*1024
def work(r):
 user,password=r.get('username'),r.get('password')
 if not isinstance(user,str) or not isinstance(password,str) or not user or not password or len(user)>254 or len(password)>2048: raise ValueError('Mailbox credentials required')
 if any(x in user for x in '\r\n\0'): raise ValueError('Invalid mailbox address')
 action=r.get('action')
 if action not in ('login','folders','messages','message','mark_read','send','draft'): raise ValueError('Unknown mail operation')
 tls=ssl.create_default_context()
 client=imaplib.IMAP4_SSL('mail.unesolutions.co.uk',993,ssl_context=tls,timeout=15)
 try:
  client.login(user,password)
  if action=='login': return {'email':user}
  if action=='folders':
   status,rows=client.list()
   if status!='OK': raise RuntimeError()
   return {'folders':parse_imap_folders(rows)}
  folder=r.get('folder','INBOX')
  if action in ('messages','message','mark_read'):
   if not isinstance(folder,str) or len(folder)>200 or any(ch in folder for ch in '\r\n\0'): raise ValueError('Invalid folder')
   status,_=client.select(imap_mailbox_arg(folder),readonly=action!='mark_read')
   if status!='OK': raise ValueError('Folder not found')
   _,validity_rows=client.response('UIDVALIDITY')
   uid_validity=(validity_rows or [b''])[0]
   uid_validity=uid_validity.decode('ascii','replace') if isinstance(uid_validity,bytes) else str(uid_validity or '')
  if action=='messages':
   status,ids=client.uid('search',None,'ALL')
   if status!='OK': raise RuntimeError()
   out=[]
   for uid in (ids[0] or b'').split()[-50:][::-1]:
    status,rows=client.uid('fetch',uid,'(BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)] FLAGS)')
    raw=next((x[1] for x in rows or [] if isinstance(x,tuple)),None)
    if status!='OK' or not raw: continue
    header=email.message_from_bytes(raw,policy=policy.default)
    flags=next((x[0] for x in rows if isinstance(x,tuple)),b'')
    out.append({'id':uid.decode(),'from':str(header.get('From','')),'to':str(header.get('To','')),'subject':str(header.get('Subject','')),'date':str(header.get('Date','')),'messageId':str(header.get('Message-ID','')),'seen':b'\\Seen' in flags})
   return {'messages':out,'uidValidity':uid_validity}
  if action in ('message','mark_read'):
   uid=str(r.get('uid',''))
   if not uid.isascii() or not uid.isdecimal() or len(uid)>19: raise ValueError('Invalid message ID')
   if action=='mark_read':
    status,_=client.uid('store',uid,'+FLAGS','(\\Seen)')
    if status!='OK': raise RuntimeError()
    return {'ok':True}
   status,rows=client.uid('fetch',uid,'(BODY.PEEK[])')
   raw=next((x[1] for x in rows or [] if isinstance(x,tuple)),None)
   if status!='OK' or not raw or len(raw)>MAX: raise ValueError('Message unavailable')
   msg=email.message_from_bytes(raw,policy=policy.default)
   plain=[];html_plain=[];attachments=[]
   for part in msg.walk():
    if part.is_multipart(): continue
    filename=part.get_filename()
    if filename:
     data=part.get_payload(decode=True) or b''
     if len(data)<=20*1024*1024: attachments.append({'name':filename[:180],'type':part.get_content_type(),'data':base64.b64encode(data).decode()})
    elif part.get_content_type()=='text/plain': plain.append(part.get_content())
    elif part.get_content_type()=='text/html':
     parser=PlainHTML();parser.feed(part.get_content());html_plain.append(''.join(parser.text))
   return {'id':uid,'from':str(msg.get('From','')),'to':str(msg.get('To','')),'subject':str(msg.get('Subject','')),'date':str(msg.get('Date','')),'body':'\n'.join(plain or html_plain),'messageId':str(msg.get('Message-ID','')),'uidValidity':uid_validity,'attachments':attachments}
  if action in ('send','draft'):
   from email.utils import parseaddr
   to,subject,body=r.get('to',''),r.get('subject',''),r.get('body','')
   if not all(isinstance(v,str) for v in (to,subject,body)) or len(subject)>500 or len(body)>2*1024*1024: raise ValueError('Invalid message')
   if action=='send' and (not to or parseaddr(to)[1]!=to or '\r' in to or '\n' in to): raise ValueError('Invalid recipient')
   msg=EmailMessage();msg['From']=user
   if to: msg['To']=to
   msg['Subject']=subject;msg['Message-ID']=make_msgid(domain=user.rsplit('@',1)[-1]);msg.set_content(body)
   total=0
   for item in r.get('attachments',[]):
    if not isinstance(item,dict): raise ValueError('Invalid attachment')
    data=base64.b64decode(item.get('data',''),validate=True);total+=len(data)
    if total>20*1024*1024: raise ValueError('Attachments too large')
    mime=item.get('type') or 'application/octet-stream'
    if not isinstance(mime,str) or mime.count('/')!=1: raise ValueError('Invalid attachment type')
    major,minor=mime.split('/')
    msg.add_attachment(data,maintype=major,subtype=minor,filename=str(item.get('name','attachment')).replace('\r','').replace('\n','')[:180])
   if action=='draft':
    try: client.create('Drafts')
    except imaplib.IMAP4.error: pass
    status,_=client.append('Drafts','\\Draft',imaplib.Time2Internaldate(time.time()),msg.as_bytes())
    if status!='OK': raise RuntimeError()
   else:
    try:
     with smtplib.SMTP('mail.unesolutions.co.uk',587,timeout=20) as smtp:
      smtp.starttls(context=tls);smtp.login(user,password);smtp.send_message(msg)
    except Exception as exc:
     # IMAP authentication already passed; do not treat SMTP rejection as
     # invalid Basic credentials or disclose provider error details.
     raise MailDeliveryError() from exc
    try:
     try: client.create('Sent')
     except imaplib.IMAP4.error: pass
     client.append('Sent','\\Seen',imaplib.Time2Internaldate(time.time()),msg.as_bytes())
    except imaplib.IMAP4.error: pass
   return {'ok':True,'messageId':str(msg['Message-ID'])}
 finally:
  try: client.logout()
  except Exception: pass
def main():
 try:
  raw=sys.stdin.buffer.read(MAX+1)
  if len(raw)>MAX: raise ValueError('Request too large')
  print(json.dumps({'ok':True,'result':work(json.loads(raw))}))
 except MailDeliveryError: print(json.dumps({'ok':False,'error':'Mail delivery failed','mailAuthenticated':True}))
 except ValueError as err: print(json.dumps({'ok':False,'error':str(err)}))
 except Exception: print(json.dumps({'ok':False,'error':'Mailbox request failed'}))
if __name__=='__main__': main()
