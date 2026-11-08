import {createHash} from 'node:crypto';
import type {SqlPersistence} from './sql-persistence.js';
import type {PoolClient} from 'pg';
import {encodeMetadataValue,decodeMetadataValues,type MetadataValueRow} from './component-runtime.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Claim={owner:true}|{owner:false;value:unknown};
type Row={input_hash:string;state:string;run_id:string|null};

/** Durable request deduplication for any Flow called with a requestId.
 * It deliberately never interprets app-specific payment or commerce metadata.
 * A failed or in-flight request cannot be silently replayed. */
export class FlowExecutionRequests {
  constructor(private readonly db:SqlPersistence) {}
  static hash(input:Record<string,unknown>){
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
  static key(input:Record<string,unknown>){
    if(!Object.hasOwn(input,'requestId'))return null;
    if(typeof input.requestId!=='string'||!uuid.test(input.requestId))
      throw new Error('Invalid Flow requestId: expected a UUID');
    return input.requestId;
  }
  async claim(tenant:string,actor:string,flow:string,requestId:string,input:Record<string,unknown>):Promise<Claim>{
    const hash=FlowExecutionRequests.hash(input);
    const inserted=await this.db.query(`INSERT INTO md_flow_execution_requests
      (tenant_id,actor_id,flow_api,request_id,input_hash)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,actor_id,flow_api,request_id) DO NOTHING RETURNING request_id`,
      [tenant,actor,flow,requestId,hash]);
    if(inserted.rowCount)return {owner:true};
    const {rows}=await this.db.query<Row>(`SELECT input_hash,state,run_id
      FROM md_flow_execution_requests
      WHERE tenant_id=$1 AND actor_id=$2 AND flow_api=$3 AND request_id=$4`,
      [tenant,actor,flow,requestId]);
    const existing=rows[0];
    if(!existing)throw new Error('Flow request conflict');
    if(existing.input_hash!==hash)
      throw new Error('Flow requestId was reused with different inputs');
    if(existing.state==='failed')
      throw new Error('Previous Flow request failed; start a new request to retry');
    if(existing.state==='completed'){
      const {rows:values}=await this.db.query<MetadataValueRow>(
        `SELECT property_path,value_kind,value_text FROM md_flow_execution_result_values
         WHERE tenant_id=$1 AND actor_id=$2 AND flow_api=$3 AND request_id=$4
         ORDER BY length(property_path),property_path`,
        [tenant,actor,flow,requestId]);
      const replay=decodeMetadataValues(values).result;
      if(!replay||typeof replay!=='object'||Array.isArray(replay))
        throw new Error('Completed Flow response is unavailable');
      return {owner:false,value:replay};
    }
    return {owner:false,value:{id:existing.run_id??'',status:'pending',completed:false}};
  }
  async started(tenant:string,actor:string,flow:string,key:string,runId:string){
    await this.db.query(`UPDATE md_flow_execution_requests SET run_id=$5,updated_at=now()
      WHERE tenant_id=$1 AND actor_id=$2 AND flow_api=$3 AND request_id=$4
        AND state='pending'`,[tenant,actor,flow,key,runId]);
  }
  private static encodeResult(result:unknown){
    const encoded=JSON.stringify(result);
    if(!encoded||encoded.length>262144)throw new Error('Flow result exceeds idempotency limit');
    const rows:Array<{path:string;kind:string;text:string|null}>=[];
    encodeMetadataValue(result,'/result',rows);
    if(rows.length>5000||rows.some(row=>row.path.length>1024))
      throw new Error('Flow response exceeds relational value limits');
    return rows;
  }
  private static async insertResult(client:PoolClient,tenant:string,actor:string,
    flow:string,key:string,rows:Array<{path:string;kind:string;text:string|null}>){
    for(const row of rows)
      await client.query(`INSERT INTO md_flow_execution_result_values
        (tenant_id,actor_id,flow_api,request_id,property_path,value_kind,value_text)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [tenant,actor,flow,key,row.path,row.kind,row.text]);
  }
  async completed(tenant:string,actor:string,flow:string,key:string,result:unknown){
    const rows=FlowExecutionRequests.encodeResult(result);
    await this.db.transaction(async client=>{
      const claim=await client.query(`UPDATE md_flow_execution_requests
        SET state='completed',updated_at=now()
        WHERE tenant_id=$1 AND actor_id=$2 AND flow_api=$3 AND request_id=$4
          AND state='pending' RETURNING request_id`,[tenant,actor,flow,key]);
      if(claim.rowCount){
        await FlowExecutionRequests.insertResult(client,tenant,actor,flow,key,rows);
        return;
      }
      // An End element in the same shared runtime may have completed the
      // request transaction already. Accept only an identical typed result.
      const {rows:status}=await client.query<{state:string}>(`
        SELECT state FROM md_flow_execution_requests
        WHERE tenant_id=$1 AND actor_id=$2 AND flow_api=$3 AND request_id=$4`,
        [tenant,actor,flow,key]);
      if(status[0]?.state!=='completed')throw new Error('Flow request no longer pending');
      const {rows:stored}=await client.query<MetadataValueRow>(`
        SELECT property_path,value_kind,value_text FROM md_flow_execution_result_values
        WHERE tenant_id=$1 AND actor_id=$2 AND flow_api=$3 AND request_id=$4`,
        [tenant,actor,flow,key]);
      const saved=new Map(stored.map(row=>[row.property_path,row]));
      if(saved.size!==rows.length||rows.some(row=>{
        const prior=saved.get(row.path);
        return !prior||prior.value_kind!==row.kind||prior.value_text!==row.text;
      }))throw new Error('Conflicting completed Flow response');
    });
  }
  /** End a paused Screen Flow and persist its replay in the caller's SQL
   * transaction. The Flow and request ledger must commit or roll back together. */
  static async completeRun(client:PoolClient,tenant:string,runId:string,result:unknown){
    const {rows:claims}=await client.query<{actor_id:string;flow_api:string;request_id:string}>(`
      UPDATE md_flow_execution_requests SET state='completed',updated_at=now()
      WHERE tenant_id=$1 AND run_id=$2 AND state='pending'
      RETURNING actor_id,flow_api,request_id`,[tenant,runId]);
    if(!claims.length)return;
    const rows=FlowExecutionRequests.encodeResult(result);
    for(const claim of claims)
      await FlowExecutionRequests.insertResult(client,tenant,claim.actor_id,
        claim.flow_api,claim.request_id,rows);
  }
  async failed(tenant:string,actor:string,flow:string,key:string){
    await this.db.query(`UPDATE md_flow_execution_requests
      SET state='failed',error_code='FLOW_EXECUTION_FAILED',updated_at=now()
      WHERE tenant_id=$1 AND actor_id=$2 AND flow_api=$3 AND request_id=$4
        AND state='pending'`,[tenant,actor,flow,key]);
  }
}
