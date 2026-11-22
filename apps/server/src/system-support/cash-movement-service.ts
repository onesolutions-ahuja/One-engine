import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
/** Whole pence; rejects negative, non-finite, >2 decimals and absurd values. */
export function paymentPence(value:unknown,label='Payment amount'):number{
 const n=typeof value==='string'&&value.trim()!==''?Number(value):value;
 if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100000000
  ||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('Invalid '+label.toLowerCase());
 return Math.round(n*100);
}

/** CASHMOVE(Direction, Amount, Reason, TillSession, [AS(x)]): cash put into ("IN") or taken out
 * of ("OUT") a till drawer during a session, outside a sale (float top-up, paid-out, bank drop).
 * Posts ONE CashLedger row in a server transaction, like the invoice payment API posts a receipt:
 * pages cannot write CashLedger directly. The user's normal CashLedger create permission
 * applies; the session must be an Opening cash count the user can read. */
export type CashMoveInput={direction:unknown;amount:unknown;reason:unknown;session:unknown;reference:unknown};
export type CashMoveResult={ledgerId:string;direction:'IN'|'OUT';amount:number;session:string};

export function validateCashMove(input:CashMoveInput){
 const direction=typeof input.direction==='string'?input.direction.trim().toUpperCase():'';
 if(direction!=='IN'&&direction!=='OUT')throw Error('CASHMOVE direction must be "IN" or "OUT"');
 const amount=paymentPence(input.amount,'Cash amount');
 if(amount<=0)throw Error('Cash amount must be more than zero');
 const reason=input.reason===undefined||input.reason===null?'':String(input.reason).trim();
 if(!reason)throw Error('Enter a reason for the cash '+(direction==='IN'?'in':'out'));
 if(reason.length>255)throw Error('Reason is too long (255 characters maximum)');
 const session=typeof input.session==='string'?input.session.trim():'';
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session))
  throw Error('Open the till first (no till session)');
 const {reference}=input;
 if(typeof reference!=='string'||reference.length<8||reference.length>128||!/^[A-Za-z0-9_.:-]+$/.test(reference))
  throw Error('Cash movement needs an idempotency reference');
 return {direction:direction as 'IN'|'OUT',amount,reason,session,reference};
}

type Engines={db:SqlPersistence;records:RecordEngine};
export async function recordCashMovement({db,records}:Engines,tenantId:string,userId:string,
 input:CashMoveInput,client?:PoolClient):Promise<CashMoveResult>{
 const m=validateCashMove(input);
 const run=async(tx:PoolClient):Promise<CashMoveResult>=>{
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenantId+':till-session:'+m.session]);
  // Reading the session through RecordEngine applies the user's own record permissions.
  const session=await records.get(tenantId,userId,'cash_count__c',m.session,tx) as Record<string,unknown>;
  if(session.count_type__c!=='Opening')throw Error('Cash in/out needs the till session (its opening count)');
  const ledgerId=await records.createInTransaction(tx,tenantId,userId,'CashLedger',{
   Name:(m.direction==='IN'?'Cash in: ':'Cash out: ')+m.reason.slice(0,60),
   TransactionType:m.direction==='IN'?'Adjustment':'Payout',Direction:m.direction,Amount:m.amount/100,
   Method:'Cash',TillSession:m.session,User:userId,SourceApp:'ActionFormula',
   TransactionDate:new Date().toISOString(),Reference:m.reference,Notes:m.reason,Status:'Posted'
  });
  return {ledgerId:String(ledgerId),direction:m.direction,amount:m.amount/100,session:m.session};
 };
 return client?run(client):db.transaction(run);
}
