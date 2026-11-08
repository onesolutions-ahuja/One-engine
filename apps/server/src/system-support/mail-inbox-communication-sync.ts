import {createConnection} from 'node:net';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {IntegrationActivityWriter} from './integration-api-log.js';
import {incomingMailIdentity} from './mail-communication-recording.js';

type MailItem={
 fingerprint:string;messageId:string;from:string;to:string;
 subject:string;body:string;receivedAt:string;
};
type ScanResult={messages:MailItem[];nextOffset:number;total:number};
const socketPath=()=>process.env.METADRIVE_MCP_BROKER_SOCKET??'/run/metadrive-mcp-broker.sock';

export function scanMaildir(address:string,offset:number):Promise<ScanResult>{
 return new Promise((resolve,reject)=>{
  const socket=createConnection(socketPath());let buffer='',done=false;
  const fail=(error:Error)=>{if(!done){done=true;socket.destroy();reject(error);}};
  socket.setTimeout(55000,()=>fail(new Error('Maildir scan timeout')));
  socket.on('error',fail);
  socket.setEncoding('utf8');
  socket.on('connect',()=>socket.end(JSON.stringify({
   action:'mailbox_scan',service:'worker',address,offset
  })+'\n'));
  socket.on('data',(part:string)=>{
   if(done)return;
   buffer+=part;
   if(buffer.length>105000){fail(new Error('Maildir scan size exceeded'));return;}
   if(!buffer.includes('\n'))return;
   try{
    const packet=JSON.parse(buffer.split('\n')[0]) as {error?:string;output?:string};
    if(packet.error||typeof packet.output!=='string')throw Error('Maildir unavailable');
    const data=JSON.parse(packet.output) as ScanResult;
    if(!data||!Array.isArray(data.messages)||
       !Number.isInteger(data.nextOffset)||data.nextOffset<0||
       data.nextOffset>20000||!Number.isInteger(data.total))
      throw Error('Malformed mail scan');
    done=true;socket.end();resolve(data);
   }catch{fail(new Error('Maildir scan unavailable'));}
  });
 });
}

/** Shared, SQL-owned inbox ingestion. Never stores mailbox login credentials.
 * Only active tenant-mapped accounts are polled. Failed scans retain their cursor,
 * and duplicate deliveries are protected in both outbox and Communication SQL.
 */
export class MailInboxCommunicationSync {
 constructor(
  private readonly db:Pick<SqlPersistence,'query'>,
  private readonly writer:IntegrationActivityWriter,
  private readonly scan:typeof scanMaildir=scanMaildir
 ){}

 async runOnce():Promise<number>{
  const {rows:mailboxes}=await this.db.query<{tenant_id:string;email:string;next_offset:number}>(`
   SELECT a.tenant_id,a.email,COALESCE(c.next_offset,0) AS next_offset
   FROM md_mail_accounts a
   JOIN md_mail_domains d ON d.tenant_id=a.tenant_id AND d.domain=a.domain
   LEFT JOIN md_mail_inbox_scan_offsets c ON c.tenant_id=a.tenant_id AND c.email=a.email
   WHERE a.status='active' AND d.verified_at IS NOT NULL
   ORDER BY COALESCE(c.scanned_at,to_timestamp(0)),a.email LIMIT 3`);
  let processed=0;
  for(const mailbox of mailboxes){
   try{
    const result=await this.scan(mailbox.email,mailbox.next_offset);
    for(const entry of result.messages){
     if(!/^[a-f0-9]{64}$/.test(entry.fingerprint)||
        typeof entry.subject!=='string'||typeof entry.body!=='string'||
        typeof entry.from!=='string'||typeof entry.to!=='string')continue;
     const externalMessageId=incomingMailIdentity(mailbox.email,entry.messageId??'',
      'maildir:'+entry.fingerprint);
     const [record,outbox]=await Promise.all([
      this.db.query(`SELECT 1 FROM md_record_values
       WHERE tenant_id=$1 AND object_api='Communication'
         AND field_api='ExternalMessageId' AND value_text=$2 LIMIT 1`,
       [mailbox.tenant_id,externalMessageId]),
      this.db.query(`SELECT 1 FROM md_communication_delivery_outbox
       WHERE tenant_id=$1 AND external_message_id=$2 LIMIT 1`,
       [mailbox.tenant_id,externalMessageId])
     ]);
     if(record.rows.length||outbox.rows.length)continue;
     const receivedAt=Number.isFinite(Date.parse(entry.receivedAt))
      ?new Date(entry.receivedAt).toISOString():new Date().toISOString();
     await this.writer({
      tenantId:mailbox.tenant_id,direction:'Inbound',transport:'SMTP',
      provider:'Docker Mailserver',
      endpoint:'imap://mail.unesolutions.co.uk:993/INBOX',method:'GET',
      outcome:'success',
      communication:{
       channel:'Email',name:'Email inbound',sender:entry.from.slice(0,500),
       recipient:(entry.to||mailbox.email).slice(0,500),
       subject:entry.subject.slice(0,500),body:entry.body.slice(0,10000),
       relatedObject:'Mailbox',provider:'Docker Mailserver',
       externalMessageId,conversationId:(entry.messageId||'').slice(0,500),
       receivedAt
      }
     });
     processed++;
    }
    // Cursor advances only after each scanned message has been durably written
    // or verified as already present. Errors retry the same page.
    await this.db.query(`INSERT INTO md_mail_inbox_scan_offsets
       (tenant_id,email,next_offset,scanned_at)
       VALUES($1,$2,$3,now())
       ON CONFLICT(tenant_id,email) DO UPDATE
         SET next_offset=excluded.next_offset,scanned_at=excluded.scanned_at`,
      [mailbox.tenant_id,mailbox.email,result.nextOffset]);
   }catch(error){
    // Do not log message contents, tenant identities or auth credentials.
    console.warn('Inbound Email Communication synchronization failed:',
     error instanceof Error?error.message:'Unknown error');
   }
  }
  return processed;
 }
}
