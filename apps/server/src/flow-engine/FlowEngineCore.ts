import {requireAvailableMetadataName} from '../system-support/metadata-name-guard.js';
import {TillPinService} from '../system-support/till-pin-service.js';
import {enforceFlowRecordAttestation} from './FlowRecordAttestationGuard.js';
import {resolveFlowLoopResources} from './FlowLoopResourceContract.js';
import {createLinkedReturnDocument,loadLinkedReturnDocument} from './FlowLinkedReturnDocument.js';
import {enforceFlowBusinessCalendar} from './FlowBusinessCalendarGuard.js';
import {failedFlowLogs,pendingFlowInterviews} from './FlowExecutionHistory.js';
import {executeActionButtonNode} from '../system-files/nodes/ActionButtonNode.js';
import {executeWaitPauseNode} from '../system-files/nodes/WaitPauseNode.js';
import {executeDecisionNode} from '../system-files/nodes/DecisionNode.js';
import {executeScreenElementNode} from '../system-files/nodes/ScreenElementNode.js';
import type { SqlPersistence } from '../system-files/sql-persistence.js';
import {encodeMetadataValue,decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';
import type { RbacEngine } from '../system-files/rbac-engine.js';
import type { RecordEngine } from '../system-files/record-engine.js';
import {evaluateFlowDecisionComparison,evaluateFlowDecisionOutcome} from '../system-files/flow-decision-runtime.js';
import {FlowRecordQuery} from '../system-files/flow-record-query.js';
import {flowDebugResources,simulateFlowGraph} from '../system-files/flow-debug-runtime.js';
import {executeFlowDataAction} from '../system-files/flow-data-actions.js';
import {executeHttpCalloutNode} from '../system-files/nodes/HttpCalloutNode.js';
import {executeFlowAssignment} from '../system-files/flow-assignment-runtime.js';
import {hydrateFlowScreenChoices} from '../system-files/flow-screen-choice-runtime.js';
import {screenRecordPayload,acceptScreenRecordSelection,ScreenSelectionError} from '../system-files/flow-screen-record-selection.js';
import {
  createFormulaEvaluationContext,isFormulaImageResult,
  type FormulaEvaluationContext
} from '../system-files/flow-formula-runtime.js';
import {flowAppIsEntitled,validateFlowDraft} from '../system-files/flow-validation.js';
import {flowFormulaReferences} from '../expression-engine/FormulaDependencyGraph.js';
import {evaluateResolvedFormulaSql} from '../system-support/formula-sql-runtime.js';
import {loadFlowCapabilityCatalog} from '../system-files/flow-capability-catalog.js';
import {executeFlowSubflow} from '../system-files/flow-subflow-runtime.js';
import {FlowExecutionRequests} from '../system-files/flow-execution-requests.js';
import {persistFlowInterviewPause} from '../system-files/flow-interview-persistence.js';
import {resolveFlowWaitUntil} from '../system-files/flow-wait-runtime.js';
import {executeFlowAction,submitFlowStageApproval,loadFlowUserResource} from '../system-files/flow-action-runtime.js';
import {executeCustomErrorNode} from '../system-files/nodes/CustomErrorNode.js';
import {executeRollbackRecordsNode} from '../system-files/nodes/RollbackRecordsNode.js';
import {cancelScheduledPathInterviews,deactivateFlowDefinition,
  syncFlowTriggerSubscription} from '../system-files/flow-subscription-runtime.js';
import {flowScalarText,isFlowScalar,parseFlowScalar,type FlowScalar} from '../system-files/flow-scalar-runtime.js';
import {auditSystemFlowContext,authorizeSystemFlowContext,flowExecutionMode,
  resolveFlowExecutionActor} from '../system-files/flow-execution-context.js';
import type {PoolClient} from 'pg';
type NodeRow={id:string;api_name:string;node_type:string};
type EdgeRow={source_api:string;target_api:string;outcome:string};
type PropRow={node_id:string;api_name:string;value_text:string|null;data_type:string};
type Scalar=FlowScalar;
type NodeProperty={value_text:string|null;data_type:string};
const namePattern=/^[A-Za-z][A-Za-z0-9_.]*$/;
const scalar=isFlowScalar;
const scalarText=flowScalarText;
const scalarFrom=parseFlowScalar;
export class FlowRuntime {
  private readonly recordQuery?:FlowRecordQuery;
  constructor(private readonly db:SqlPersistence,private readonly rbac?:RbacEngine,
    private readonly records?:RecordEngine,
    private readonly httpCallout?:(tenantId:string,userId:string,config:Record<string,unknown>,
      variables:Record<string,Scalar>,idempotencyKey:string,
      execution?:{client:PoolClient;runId:string;nodeId:number})=>Promise<{status:number;body:string}>,
    private readonly scheduleResume?:(client:PoolClient,tenantId:string,userId:string,
      flowApi:string,version:number,runId:string,scheduledAt:Date,step:number,
      appApiName?:string)=>Promise<void>,
    private readonly queueFlowEmail?:(client:PoolClient,tenantId:string,userId:string,
      flowId:string,version:number,runId:string,nodeId:number,step:number,
      message:{credentialId:string;from:string;recipients:string[];subject:string;body:string})=>Promise<void>) {
    if(rbac)this.recordQuery=new FlowRecordQuery(db,rbac);
  }
  /** Builder drafts are checked against executable SQL Flow capabilities, never assumed executable. */
  async validateDraft(tenantId:string,userId:string,apiName:string,draft:unknown){
    if(!this.rbac)throw new Error('Flow permissions not configured');
    await this.rbac.require(tenantId,userId,'FlowDefinition','manage');
    const capabilities=await loadFlowCapabilityCatalog(this.db,tenantId);
    return validateFlowDraft(this.rbac,tenantId,userId,apiName,draft,this.db,capabilities);
  }
  /** Complete metadata Editor contract: one latest definition per API name. */
  async loadEditor(tenantId:string,apiName:string) {
    const {rows}=await this.db.query<{id:string;api_name:string;label:string|null;flow_type:string;version:number;active:boolean}>(`
      SELECT id,api_name,label,flow_type,version,active FROM md_flow_definitions
      WHERE tenant_id=$1 AND api_name=$2 AND archived=false ORDER BY version DESC LIMIT 1
    `,[tenantId,apiName]);
    const record=rows[0];
    if(!record)throw new Error('Flow not found');
    const [data,history]=await Promise.all([
      this.db.query<MetadataValueRow>(
        'SELECT property_path,value_kind,value_text FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',
        [tenantId,record.id]),
      this.db.query<{version:number;active:boolean}>(
        'SELECT version,active FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 AND archived=false ORDER BY version',
        [tenantId,apiName])
    ]);
    let document=decodeMetadataValues(data.rows).builder as Record<string,unknown>|undefined;
    if(!document){
      // Pre-Builder SQL definitions remain visible and editable, without fabricating stored actions.
      const [nodes,edges]=await Promise.all([
        this.db.query<{api_name:string;node_type:string}>(
          'SELECT api_name,node_type FROM md_flow_nodes WHERE tenant_id=$1 AND flow_id=$2 ORDER BY sort_order',
          [tenantId,record.id]),
        this.db.query<{source_api:string;target_api:string;outcome:string}>(
          'SELECT source_api,target_api,outcome FROM md_flow_edges WHERE tenant_id=$1 AND flow_id=$2',
          [tenantId,record.id])
      ]);
      const ids=new Map(nodes.rows.map((node,index)=>[node.api_name,index+1]));
      document={
        elements:nodes.rows.map((node,index)=>({id:index+1,type:node.node_type,label:node.node_type,config:{}})),
        connectors:edges.rows.filter(edge=>ids.has(edge.source_api)&&ids.has(edge.target_api))
          .map((edge,index)=>({id:'edge-'+index,from:ids.get(edge.source_api),to:ids.get(edge.target_api),
            kind:'normal',label:edge.outcome})),
        resources:[],startConfig:{},tests:[]
      };
    }
    return {...document,apiName:record.api_name,label:record.label??record.api_name,
      flowType:record.flow_type,versionNumber:record.version,status:record.active?'Active':'Draft',
      activeVersion:history.rows.find(item=>item.active)?.version??null,
      startConfig:document.startConfig && typeof document.startConfig==='object' && !Array.isArray(document.startConfig)
        ?document.startConfig:{},
      elements:Array.isArray(document.elements)?document.elements:[],
      connectors:Array.isArray(document.connectors)?document.connectors:[],
      resources:Array.isArray(document.resources)?document.resources:[],
      versions:history.rows.map(item=>({versionNumber:item.version,status:item.active?'Active':'Obsolete',
        savedAt:''}))};
  }
  async loadEditorVersion(tenantId:string,apiName:string,version:unknown) {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)||!Number.isSafeInteger(Number(version))
      ||Number(version)<1)throw new Error('Invalid Flow version');
    const {rows}=await this.db.query<{
      id:string;api_name:string;label:string|null;flow_type:string;version:number;active:boolean
    }>(`SELECT id,api_name,label,flow_type,version,active FROM md_flow_definitions
      WHERE tenant_id=$1 AND api_name=$2 AND version=$3 AND archived=false`,
    [tenantId,apiName,Number(version)]);
    const record=rows[0];
    if(!record)throw new Error('Flow version not found');
    const values=await this.db.query<MetadataValueRow>(
      'SELECT property_path,value_kind,value_text FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',
      [tenantId,record.id]);
    let document=decodeMetadataValues(values.rows).builder as Record<string,unknown>|undefined;
    if(!document){
      const [nodes,edges]=await Promise.all([
        this.db.query<{api_name:string;node_type:string}>(
          'SELECT api_name,node_type FROM md_flow_nodes WHERE tenant_id=$1 AND flow_id=$2 ORDER BY sort_order',
          [tenantId,record.id]),
        this.db.query<{source_api:string;target_api:string;outcome:string}>(
          'SELECT source_api,target_api,outcome FROM md_flow_edges WHERE tenant_id=$1 AND flow_id=$2',
          [tenantId,record.id])
      ]);
      const ids=new Map(nodes.rows.map((node,index)=>[node.api_name,index+1]));
      document={
        elements:nodes.rows.map((node,index)=>({id:index+1,type:node.node_type,label:node.node_type,config:{}})),
        connectors:edges.rows.filter(edge=>ids.has(edge.source_api)&&ids.has(edge.target_api))
          .map((edge,index)=>({id:'edge-'+index,from:ids.get(edge.source_api),to:ids.get(edge.target_api),
            kind:'normal',label:edge.outcome})),
        resources:[],startConfig:{},tests:[]
      };
    }
    return {...document,versionNumber:record.version,status:record.active?'Active':'Obsolete',
      savedAt:'',label:record.label??apiName,flowType:record.flow_type,
      elements:Array.isArray(document.elements)?document.elements:[],
      connectors:Array.isArray(document.connectors)?document.connectors:[],
      resources:Array.isArray(document.resources)?document.resources:[],
      tests:Array.isArray(document.tests)?document.tests:[]};
  }
  async list(tenantId:string) {
    const {rows}=await this.db.query<{api_name:string}>(`
      SELECT DISTINCT api_name FROM md_flow_definitions
      WHERE tenant_id=$1 AND archived=false ORDER BY api_name LIMIT 500
    `,[tenantId]);
    return Promise.all(rows.map(row=>this.loadEditor(tenantId,row.api_name)));
  }
  async listPage(tenantId:string,page:unknown=1,search:unknown='',flowType:unknown='') {
    const index=Number(page);
    if(!Number.isSafeInteger(index)||index<1||index>100000||typeof search!=='string'||search.length>100
      ||typeof flowType!=='string'||(flowType!==''&&!['Screen Flow','In-Screen Flow','Autolaunched Flow','Record-Triggered Flow','Schedule-Triggered Flow','Platform Event-Triggered Flow','Flow Orchestration'].includes(flowType)))
      throw new Error('Invalid Flow list query');
    const query='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
    const {rows}=await this.db.query<{api_name:string;total:string}>(`
      SELECT names.api_name,(SELECT count(DISTINCT api_name)::text FROM md_flow_definitions
        WHERE tenant_id=$1 AND archived=false AND ($4='' OR flow_type=$4) AND (api_name ILIKE $2 ESCAPE '\\'
          OR label ILIKE $2 ESCAPE '\\')) AS total
      FROM (SELECT DISTINCT api_name FROM md_flow_definitions
        WHERE tenant_id=$1 AND archived=false AND ($4='' OR flow_type=$4) AND (api_name ILIKE $2 ESCAPE '\\'
          OR label ILIKE $2 ESCAPE '\\')
        ORDER BY api_name LIMIT 50 OFFSET $3) names
    `,[tenantId,query,(index-1)*50,flowType]);
    const flows=await Promise.all(rows.map(row=>this.loadEditor(tenantId,row.api_name)));
    // A page past the last result still needs the true count.
    const total=rows[0]?.total ?? (await this.db.query<{total:string}>(`
      SELECT count(DISTINCT api_name)::text AS total FROM md_flow_definitions
      WHERE tenant_id=$1 AND archived=false AND ($3='' OR flow_type=$3) AND (api_name ILIKE $2 ESCAPE '\\'
        OR label ILIKE $2 ESCAPE '\\')`,[tenantId,query,flowType])).rows[0]?.total??'0';
    return {flows,total:Number(total),page:index,pageSize:50};
  }
  private excelGraphFingerprint(snapshot:Record<string,unknown>):string {
    const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):
      value&&typeof value==='object'?Object.fromEntries(Object.entries(value as Record<string,unknown>)
        .sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)])):value;
    const source=JSON.stringify(canonical({
      apiName:snapshot.apiName,versionNumber:snapshot.versionNumber,flowType:snapshot.flowType,
      status:snapshot.status,startConfig:snapshot.startConfig??{},
      elements:snapshot.elements,connectors:snapshot.connectors,resources:snapshot.resources
    }));
    let hash=2166136261;
    for(let i=0;i<source.length;i++){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return (hash>>>0).toString(16).padStart(8,'0');
  }
  async saveEditor(tenantId:string,userId:string,apiName:string,raw:unknown,createOnly=false) {
    if(!this.rbac)throw new Error('Flow permissions not configured');
    await this.rbac.require(tenantId,userId,'FlowDefinition','manage');
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)||!raw||typeof raw!=='object'||Array.isArray(raw))
      throw new Error('Invalid Flow metadata');
    const input=raw as Record<string,unknown>;
    const excelExpectedSnapshot=input.__excelExpectedFingerprint;
    if(excelExpectedSnapshot!==undefined
      &&(typeof excelExpectedSnapshot!=='string'||!/^[a-f0-9]{8}$/.test(excelExpectedSnapshot)))
      throw Error('Invalid Excel flow snapshot');
    delete input.__excelExpectedFingerprint;
    if(input.apiName!==apiName||typeof input.label!=='string'||!input.label.trim()||input.label.length>200
      ||!['Screen Flow','In-Screen Flow','Record-Triggered Flow','Autolaunched Flow','Flow Orchestration',
        'Schedule-Triggered Flow','Platform Event-Triggered Flow'].includes(String(input.flowType))
      ||!['Draft','Active'].includes(String(input.status))
      ||!Array.isArray(input.elements)||input.elements.length>250
      ||!Array.isArray(input.connectors)||input.connectors.length>500
      ||!Array.isArray(input.resources??[])||!Array.isArray(input.tests??[]))
      throw new Error('Invalid Flow metadata');
    const ids=new Set<number>();
    for(const item of input.elements as unknown[]) {
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid Flow element');
      const el=item as Record<string,unknown>;
      if(!Number.isSafeInteger(el.id)||ids.has(Number(el.id))||typeof el.type!=='string'||
        typeof el.label!=='string'||!el.config||typeof el.config!=='object'||Array.isArray(el.config))
        throw new Error('Invalid Flow element');
      ids.add(Number(el.id));
    }
    for(const item of input.connectors as unknown[]) {
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid Flow connector');
      const edge=item as Record<string,unknown>;
      if(!ids.has(Number(edge.from))||!ids.has(Number(edge.to)))throw new Error('Invalid Flow connector');
    }
    const startNode=(input.elements as Array<Record<string,unknown>>)
      .find(element=>element.type==='Start');
    const startConfig=startNode?.config&&typeof startNode.config==='object'
      &&!Array.isArray(startNode.config)?startNode.config as Record<string,unknown>:{};
    const executionContext=flowExecutionMode(startConfig.executionContext);
    if(input.status==='Active'){
      const validation=await this.validateDraft(tenantId,userId,apiName,input);
      if(!validation.valid)throw new Error('Flow cannot activate: '+validation.errors.join('; '));
      if(!await flowAppIsEntitled(this.db,tenantId,
        typeof input.appApiName==='string'?input.appApiName:null))
        throw new Error('Flow app is not installed or entitled for this tenant');
    }
    const systemActor=executionContext==='System'&&input.status==='Active'
      ?await authorizeSystemFlowContext(this.db,this.rbac,tenantId,apiName,userId):null;
    const scalarRows:Array<{path:string;kind:string;text:string|null}>=[];
    // Preserve the entire editable graph as relational path/value rows; never JSONB.
    encodeMetadataValue(input,'/builder',scalarRows);
    if(scalarRows.some(row=>row.path.length>1024))throw new Error('Invalid Flow metadata path');
    await this.db.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
        [tenantId+':flow:'+apiName]);
      const latest=await client.query<{id:string;version:number;active:boolean}>(`
        SELECT id,version,active FROM md_flow_definitions
        WHERE tenant_id=$1 AND api_name=$2 AND archived=false ORDER BY version DESC LIMIT 1 FOR UPDATE
      `,[tenantId,apiName]);
      const last=latest.rows[0];
      if(excelExpectedSnapshot!==undefined){
        if(!last)throw Error('Excel upload cannot create a Flow; existing Flow was deleted');
        const persisted=await client.query<MetadataValueRow>(
          'SELECT property_path,value_kind,value_text FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',
          [tenantId,last.id]);
        const doc=decodeMetadataValues(persisted.rows).builder as Record<string,unknown>|undefined;
        if(!doc)throw Error('Legacy Flow must first be saved through Flow Builder before Excel upsert');
        const actual=this.excelGraphFingerprint({
          ...doc,apiName,versionNumber:last.version,
          flowType:doc.flowType,status:last.active?'Active':'Draft'
        });
        if(actual!==excelExpectedSnapshot)
          throw Error('Flow changed after Excel download; reload and download a fresh workbook');
      }
      // MCP may author only a missing Flow; never replace a tenant Flow by
      // guessing its identity or racing a parallel Builder save.
      if(createOnly&&last)throw new Error('Flow already exists');
      if(!last)await requireAvailableMetadataName(client,tenantId,'flow',apiName);
      if(input.status==='Active'){
        await client.query(`
          UPDATE md_flow_definitions SET active=false
          WHERE tenant_id=$1 AND api_name=$2 AND active=true`,[tenantId,apiName]);
      }
      let id:string;
      if(last&&!last.active){
        id=last.id;
        await client.query(`UPDATE md_flow_definitions SET label=$3,flow_type=$4,active=$5,
          system_context_approved_by=$6 WHERE tenant_id=$1 AND id=$2`,
         [tenantId,id,input.label,input.flowType,input.status==='Active',
          systemActor?userId:null]);
      }else{
        const inserted=await client.query<{id:string}>(`
          INSERT INTO md_flow_definitions
           (tenant_id,api_name,label,flow_type,version,active,system_context_approved_by)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id
        `,[tenantId,apiName,input.label,input.flowType,(last?.version??0)+1,
          input.status==='Active',systemActor?userId:null]);
        id=inserted.rows[0].id;
      }
      if(input.status==='Active'){
        if(systemActor)await auditSystemFlowContext(client,tenantId,id,userId,userId,
          'system-context-approved');
        await cancelScheduledPathInterviews(client,tenantId,apiName,id);
      }
      await client.query('DELETE FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',[tenantId,id]);
      for(const row of scalarRows)await client.query(`
        INSERT INTO md_flow_editor_values(tenant_id,flow_id,property_path,value_kind,value_text)
        VALUES($1,$2,$3,$4,$5)`,[tenantId,id,row.path,row.kind,row.text]);
      await syncFlowTriggerSubscription(client,tenantId,apiName,id,{
        active:input.status==='Active',flowType:String(input.flowType),
        elements:input.elements as unknown[],appApiName:input.appApiName
      });
      await client.query('DELETE FROM md_flow_edges WHERE tenant_id=$1 AND flow_id=$2',[tenantId,id]);
      await client.query('DELETE FROM md_flow_nodes WHERE tenant_id=$1 AND flow_id=$2',[tenantId,id]);
      // Published definitions execute directly from md_flow_editor_values.
      // md_flow_nodes and md_flow_edges are retained only for older SQL-only Flows.
    });
    return this.loadEditor(tenantId,apiName);
  }
  async deleteEditor(tenantId:string,userId:string,apiName:string) {
    if(!this.rbac)throw new Error('Flow permissions not configured');
    await this.rbac.require(tenantId,userId,'FlowDefinition','manage');
    const rowCount=await deactivateFlowDefinition(this.db,tenantId,apiName,true);
    if(!rowCount)throw new Error('Flow not found');
  }
  async failedLogs(tenantId:string,userId:string) {
    return failedFlowLogs(this.db,this.rbac,tenantId,userId);
  }
  async pendingInterviews(tenantId:string,userId:string) {
    return pendingFlowInterviews(this.db,this.rbac,tenantId,userId);
  }
  /** Cancel a durable pending interview without deleting its execution history. */
  async cancelInterview(tenantId:string,userId:string,interviewId:string){
    if(!this.rbac)throw new Error('Flow permissions not configured');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(interviewId))
      throw new Error('Invalid interview ID');
    await this.rbac.require(tenantId,userId,'FlowDefinition','manage');
    const result=await this.db.transaction(async client=>{
      // Approval decisions lock the stage before the run. Cancellation must
      // use the same order to avoid cross-approver/cancel deadlocks.
      await client.query(`
        SELECT 1 FROM md_flow_approval_stages
        WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE
      `,[tenantId,interviewId]);
      const cancelled=await client.query(
        "UPDATE md_flow_runs SET status='cancelled',finished_at=now(),wait_until=NULL,error_code=NULL WHERE tenant_id=$1 AND id=$2 AND status IN ('pending','waiting') RETURNING id",
        [tenantId,interviewId]);
      if(!cancelled.rowCount)throw new Error('Pending interview not found');
      await client.query(`
        UPDATE md_flow_approval_stages SET status='cancelled',finished_at=now()
        WHERE tenant_id=$1 AND run_id=$2 AND status='waiting'
      `,[tenantId,interviewId]);
      await client.query(`
        UPDATE md_approval_requests SET status='Canceled'
        WHERE tenant_id=$1 AND group_id IN
          (SELECT group_id FROM md_flow_approval_stages WHERE tenant_id=$1 AND run_id=$2)
          AND status='Pending'
      `,[tenantId,interviewId]);
      await client.query(`UPDATE md_durable_jobs SET status='cancelled',lease_owner=NULL,
        lease_until=NULL,updated_at=now()
        WHERE tenant_id=$1 AND job_type='flow.resume' AND resource_id=$2 AND status IN ('queued','leased')`,
      [tenantId,interviewId]);
      return cancelled;
    });
    if(!result.rowCount)throw new Error('Pending interview not found');
    return {cancelled:true};
  }
  async deactivate(tenantId:string,userId:string,apiName:string) {
    if(!this.rbac)throw new Error('Flow permissions not configured');
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName))throw new Error('Invalid Flow name');
    await this.rbac.require(tenantId,userId,'FlowDefinition','manage');
    const rowCount=await deactivateFlowDefinition(this.db,tenantId,apiName);
    if(!rowCount)throw new Error('Active flow not found');
    return {flow:await this.loadEditor(tenantId,apiName)};
  }
  async loadActive(tenantId:string,apiName:string) {
    const {rows}=await this.db.query<{id:string;version:number;system_context_approved_by:string|null}>(
      `SELECT id,version,system_context_approved_by FROM md_flow_definitions
       WHERE tenant_id=$1 AND api_name=$2 AND active=true ORDER BY version DESC LIMIT 1`,
      [tenantId,apiName]);
    if(!rows[0])throw new Error('Active flow not found');
    return rows[0];
  }
  async start(tenantId:string,flowApi:string,userId:string,inputs:Record<string,unknown>={}) {
    if(!this.rbac)throw new Error('Flow permissions not configured');
    await this.rbac.require(tenantId,userId,'Flow:'+flowApi,'execute');
    if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||Object.keys(inputs).length>100)
      throw new Error('Invalid Flow inputs');
    const normalized=new Map<string,Scalar>();
    const collections=new Map<string,{objectApi:string;records:Array<Record<string,Scalar>>}>();
    for(const [name,value] of Object.entries(inputs)) {
      if(!namePattern.test(name))throw new Error('Invalid Flow input: '+name);
      if(scalar(value)){
        if(typeof value==='string'&&value.length>4096)throw new Error('Invalid Flow input: '+name);
        normalized.set(name,value);
      }else if(Array.isArray(value)){
        collections.set(name,{objectApi:'',records:[]});
      }else throw new Error('Invalid Flow input: '+name);
    }
    const flow=await this.loadActive(tenantId,flowApi);
    const editor=await this.db.query<MetadataValueRow>(
      'SELECT property_path,value_kind,value_text FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',
      [tenantId,flow.id]);
    const graph=decodeMetadataValues(editor.rows).builder as Record<string,unknown>|undefined;
    const elements=Array.isArray(graph?.elements)?graph.elements as Array<Record<string,unknown>>:[];
    const startNode=elements.find(element=>element.type==='Start');
    const startConfig=startNode?.config&&typeof startNode.config==='object'
      &&!Array.isArray(startNode.config)?startNode.config as Record<string,unknown>:{};
    const mode=flowExecutionMode(startConfig.executionContext);
    if(!await flowAppIsEntitled(this.db,tenantId,
      typeof graph?.appApiName==='string'?graph.appApiName:null))
      throw new Error('Flow app is not installed or entitled for this tenant');
    const executionActor=await resolveFlowExecutionActor(this.db,this.rbac,tenantId,flowApi,
      userId,mode,flow.system_context_approved_by);
    let collectionStart:number|undefined;
    if(collections.size){
      const resources=Array.isArray(graph?.resources)
        ?graph.resources as Array<Record<string,unknown>>:[];
      const starts=elements.filter(element=>element.type==='Start');
      if(starts.length!==1||typeof starts[0].id!=='number'||!Number.isSafeInteger(starts[0].id))
        throw new Error('Record Collection inputs require a valid Flow Start element');
      collectionStart=starts[0].id;
      let totalTextLength=0;
      let totalRecordCount=0;
      for(const [name,input] of collections){
        const resource=resources.find(item=>item.name===name);
        if(resource?.type!=='Record Collection'||resource.isCollection!==true
          ||resource.availableForInput!==true||typeof resource.dataType!=='string'
          ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(resource.dataType))
          throw new Error('Flow input is not a declared Record Collection: '+name);
        const object=await this.db.query(
          'SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',
          [tenantId,resource.dataType]);
        if(!object.rowCount)throw new Error('Flow Record Collection Object is unavailable: '+resource.dataType);
        input.objectApi=resource.dataType;
        const raw=inputs[name] as unknown[];
        if(raw.length>200)throw new Error('Flow Record Collection input exceeds the 200-record limit: '+name);
        totalRecordCount+=raw.length;
        if(totalRecordCount>200)
          throw new Error('Flow Record Collection inputs exceed the 200-record limit');
        input.records=raw.map(record=>{
          if(!record||typeof record!=='object'||Array.isArray(record)
            ||(Object.getPrototypeOf(record)!==Object.prototype&&Object.getPrototypeOf(record)!==null))
            throw new Error('Flow Record Collection items must be records: '+name);
          const entries=Object.entries(record);
          if(!entries.length||entries.length>100)
            throw new Error('Flow Record Collection records must contain between 1 and 100 fields: '+name);
          const fields:Record<string,Scalar>=Object.create(null) as Record<string,Scalar>;
          for(const [field,value] of entries){
            if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)||field==='Id'||!scalar(value)
              ||typeof value==='string'&&value.length>4096)
              throw new Error('Invalid Flow Record Collection field: '+field);
            totalTextLength+=field.length+(typeof value==='string'?value.length:String(value).length);
            if(totalTextLength>262144)
              throw new Error('Flow Record Collection inputs exceed the 256 KB limit');
            fields[field]=value;
          }
          return fields;
        });
      }
    }
    return this.db.transaction(async client=>{
      const {rows}=await client.query<{id:string}>(
        `INSERT INTO md_flow_runs
         (tenant_id,flow_id,started_by,initiated_by,execution_context,status)
         VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
        [tenantId,flow.id,executionActor.actorUserId,userId,executionActor.mode]);
      const id=rows[0].id;
      if(executionActor.mode==='System')await auditSystemFlowContext(client,tenantId,flow.id,
        executionActor.actorUserId,userId,'system-context-run',id);
      for(const [name,value] of normalized) {
        const encoded=scalarText(value);
        await client.query(
          'INSERT INTO md_flow_run_inputs (tenant_id,run_id,api_name,value_text,data_type) VALUES ($1,$2,$3,$4,$5)',
          [tenantId,id,name,encoded.text,encoded.type]);
      }
      if(collectionStart!==undefined){
        await client.query(
          'INSERT INTO md_flow_interview_state(tenant_id,run_id,current_element) VALUES($1,$2,$3)',
          [tenantId,id,collectionStart]);
        for(const [name,collection] of collections){
          const records=collection.records.length?collection.records:[Object.create(null) as Record<string,Scalar>];
          for(const [sortOrder,record] of records.entries()){
            await client.query(`INSERT INTO md_flow_interview_records
              (tenant_id,run_id,api_name,object_api,sort_order,record_id,is_collection)
              VALUES($1,$2,$3,$4,$5,NULL,true)`,
            [tenantId,id,name,collection.objectApi,sortOrder]);
            for(const [field,value] of Object.entries(record)){
              const encoded=scalarText(value);
              await client.query(`INSERT INTO md_flow_interview_record_fields
                (tenant_id,run_id,api_name,sort_order,field_api,value_text,data_type)
                VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [tenantId,id,name,sortOrder,field,encoded.text,encoded.type]);
            }
          }
        }
      }
      return id;
    });
  }
  async execute(tenantId:string,flowApi:string,userId:string,inputs:Record<string,unknown>={}) {
    if(!this.rbac)throw new Error('Flow permissions not configured');
    await this.rbac.require(tenantId,userId,'Flow:'+flowApi,'execute');
    const definition=await this.loadActive(tenantId,flowApi);
    const {rows}=await this.db.query<{flow_type:string;has_editor:boolean}>(`
      SELECT f.flow_type,EXISTS(SELECT 1 FROM md_flow_editor_values x
        WHERE x.tenant_id=f.tenant_id AND x.flow_id=f.id) AS has_editor
      FROM md_flow_definitions f WHERE f.tenant_id=$1 AND f.id=$2`,[tenantId,definition.id]);
    if(rows[0]?.flow_type==='Record-Triggered Flow'||rows[0]?.flow_type==='Schedule-Triggered Flow'
      ||rows[0]?.flow_type==='Platform Event-Triggered Flow')
      throw new Error('Triggered Flows cannot be manually executed');
    // Core identity capability invoked only through an entitled, active, metadata-declared Flow.
    // Never allow the caller to select a target user or retrieve a stored PIN.
    if(rows[0]?.has_editor){
      const editor=await this.loadEditor(tenantId,flowApi);
      const startConfig=editor.startConfig as Record<string,unknown>;
      if(startConfig.businessCalendarGuard)await enforceFlowBusinessCalendar(
        this.db,tenantId,startConfig.businessCalendarGuard,inputs);
      if(startConfig.recordAttestationGuard)await enforceFlowRecordAttestation(
        this.db,tenantId,userId,startConfig.recordAttestationGuard,inputs);
      if(startConfig.securityOperation==='LoadLinkedReturnDocument'){
        if(!this.recordQuery)throw Error('Record query services unavailable');
        return loadLinkedReturnDocument(this.recordQuery,tenantId,userId,
          startConfig.returnDocumentConfig,inputs);
      }
      if(startConfig.securityOperation==='CreateLinkedReturnDocument'){
        if(!this.records||!this.recordQuery)throw Error('Record services unavailable for return operation');
        return createLinkedReturnDocument(this.db,this.records,this.recordQuery,
          tenantId,userId,startConfig.returnDocumentConfig,inputs);
      }
      if(startConfig.securityOperation==='VerifyCurrentUserTillPin'){
        const verified=await new TillPinService(this.db).verify(tenantId,userId,inputs.pin);
        return {completed:true,status:'completed',outputs:{verified}};
      }
    }
    const requests=new FlowExecutionRequests(this.db);
    const requestId=FlowExecutionRequests.key(inputs);
    if(requestId){
      const claim=await requests.claim(tenantId,userId,flowApi,requestId,inputs);
      if(!claim.owner)return claim.value;
    }
    try{
      const id=await this.start(tenantId,flowApi,userId,inputs);
      if(requestId)await requests.started(tenantId,userId,flowApi,requestId,id);
      const {rows:actors}=await this.db.query<{started_by:string}>(
        'SELECT started_by FROM md_flow_runs WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
      const executionUserId=actors[0]?.started_by;
      if(!executionUserId)throw new Error('Flow run has no execution identity');
      // Only shared durable runtimes execute actions; caller-selected request IDs
      // cannot create another interview after the SQL ledger has claimed them.
      const result=rows[0]?.has_editor
        ?await this.advanceInterview(tenantId,executionUserId,id,{})
        :await this.run(tenantId,id,executionUserId);
      if(requestId && result.status==='completed')
        await requests.completed(tenantId,userId,flowApi,requestId,result);
      return result;
    }catch(error){
      if(requestId)await requests.failed(tenantId,userId,flowApi,requestId);
      throw error;
    }
  }

  async resumeWaitingInterview(tenantId:string,userId:string,runId:string,version:number){
    if(!this.rbac)throw new Error('Flow permissions not configured');
    if(!/^[0-9a-f-]{36}$/i.test(runId)||!Number.isSafeInteger(version)||version<1)
      throw new Error('Invalid waiting Flow interview');
    let eligible=false;
    try{return await this.db.transaction(async client=>{
       const {rows}=await client.query<{api_name:string;started_by:string;version:number}>(`
         SELECT f.api_name,r.started_by,f.version FROM md_flow_runs r
         JOIN md_flow_definitions f ON f.tenant_id=r.tenant_id AND f.id=r.flow_id
         WHERE r.tenant_id=$1 AND r.id=$2 AND r.status='waiting' AND r.wait_until<=now()
           AND f.active=true AND f.archived=false FOR UPDATE OF r
       `,[tenantId,runId]);
       const interview=rows[0];
       if(!interview||interview.started_by!==userId||interview.version!==version)
         throw new Error('Waiting Flow interview is no longer eligible');
       eligible=true;
       await client.query(`UPDATE md_flow_runs SET status='pending',wait_until=NULL
         WHERE tenant_id=$1 AND id=$2 AND status='waiting'`,[tenantId,runId]);
       return this.advanceInterview(tenantId,userId,runId,{},client);
     });
    }catch(error){
     if(eligible)await this.db.query(`UPDATE md_flow_runs SET status='failed',finished_at=now(),
       wait_until=NULL,error_code='FLOW_RESUME_FAILED'
       WHERE tenant_id=$1 AND id=$2 AND started_by=$3 AND status IN ('pending','waiting')`,
     [tenantId,runId,userId]);
     throw error;
    }
  }

  /** Resume a Screen Flow from durable SQL state. The caller must own the interview. */
  async advanceInterview(tenantId:string,userId:string,runId:string,
    request:{action?:unknown;outcome?:unknown;values?:unknown},executor?:PoolClient,
    callStack:string[]=[]){
    if(!this.rbac||!this.records)throw new Error('Flow executor not configured');
    if(!/^[0-9a-f-]{36}$/i.test(runId)||!request||typeof request!=='object')
      throw new Error('Invalid Flow interview request');
    const advance=async(client:PoolClient)=>{
      const {rows}=await client.query<{
        flow_id:string;api_name:string;flow_type:string;version:number;started_by:string;
        initiated_by:string;execution_context:string;system_context_approved_by:string|null;status:string
      }>(`SELECT r.flow_id,f.api_name,f.flow_type,f.version,r.started_by,r.initiated_by,
          r.execution_context,f.system_context_approved_by,r.status FROM md_flow_runs r
        JOIN md_flow_definitions f ON f.tenant_id=r.tenant_id AND f.id=r.flow_id
        WHERE r.tenant_id=$1 AND r.id=$2 AND f.active=true AND f.archived=false
        FOR UPDATE OF r,f`,[tenantId,runId]);
      const active=rows[0];
      if(!active||active.status!=='pending'||active.started_by!==userId
        ||!['Screen Flow','In-Screen Flow','Autolaunched Flow','Record-Triggered Flow','Schedule-Triggered Flow',
          'Platform Event-Triggered Flow','Flow Orchestration'].includes(active.flow_type))
        throw new Error('Pending Flow interview not found');
      const nested=callStack.at(-1)===active.api_name;
      if(callStack.length>16||!nested&&callStack.includes(active.api_name))
        throw new Error('Recursive or excessively nested Flow invocation');
      const activeCallStack=nested?callStack:[...callStack,active.api_name];
      await this.rbac!.require(tenantId,userId,'Flow:'+active.api_name,'execute');
      const doc=await client.query<MetadataValueRow>(
        'SELECT property_path,value_kind,value_text FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',
        [tenantId,active.flow_id]);
      const graph=decodeMetadataValues(doc.rows).builder as Record<string,unknown>|undefined;
      if(!graph||!Array.isArray(graph.elements)||!Array.isArray(graph.connectors))
        throw new Error('Missing published Screen Flow graph');
      if(!await flowAppIsEntitled(client,tenantId,
        typeof graph.appApiName==='string'?graph.appApiName:null))
        throw new Error('Flow app is not installed or entitled for this tenant');
      const elements=graph.elements as Array<{id:number;type:string;label:string;config:Record<string,unknown>}>;
      const connectors=graph.connectors as Array<{from:number;to:number;label:string;kind:string}>;
      const byId=new Map(elements.map(element=>[element.id,element]));
      const start=elements.filter(element=>element.type==='Start');
      if(start.length!==1||byId.size!==elements.length)throw new Error('Invalid Screen Flow graph');
      const mode=flowExecutionMode(start[0].config.executionContext);
      if(mode!==flowExecutionMode(active.execution_context))
        throw new Error('Flow execution context changed during the interview');
      const actor=await resolveFlowExecutionActor(client,this.rbac!,tenantId,active.api_name,
        active.initiated_by??active.started_by,mode,active.system_context_approved_by??null);
      if(actor.actorUserId!==userId||active.started_by!==userId)
        throw new Error('Flow execution identity is no longer authorized');
      const persisted=await client.query<{current_element:number;history_elements:number[];step_count:number}>(
        'SELECT current_element,history_elements,step_count FROM md_flow_interview_state WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE',
        [tenantId,runId]);
      if(!persisted.rows[0])await client.query(
        'INSERT INTO md_flow_interview_state(tenant_id,run_id,current_element) VALUES($1,$2,$3)',
        [tenantId,runId,start[0].id]);
      const state=persisted.rows[0]??{current_element:start[0].id,history_elements:[],step_count:0};
      const persistedLoops=await client.query<{element_id:number;next_index:number}>(
        'SELECT element_id,next_index FROM md_flow_interview_loop_state WHERE tenant_id=$1 AND run_id=$2',
        [tenantId,runId]);
      const loopIndexes=new Map(persistedLoops.rows.map(row=>[row.element_id,row.next_index]));
      const prior=await client.query<{api_name:string;value_text:string|null;data_type:string}>(
        'SELECT api_name,value_text,data_type FROM md_flow_run_inputs WHERE tenant_id=$1 AND run_id=$2',
        [tenantId,runId]);
      const stored=await client.query<{api_name:string;value_text:string|null;data_type:string}>(
        'SELECT api_name,value_text,data_type FROM md_flow_interview_values WHERE tenant_id=$1 AND run_id=$2',
        [tenantId,runId]);
      const vars:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
      for(const row of [...prior.rows,...stored.rows])
        vars[row.api_name]=scalarFrom(row.value_text,row.data_type);
      let formulaContext=await loadFlowUserResource(
        client,tenantId,userId,JSON.stringify([graph.resources,graph.elements]),vars,this.rbac);
      const persistedRecords=await client.query<{
        api_name:string;object_api:string;record_id:string|null;is_collection:boolean;sort_order:number
      }>(`SELECT api_name,object_api,record_id,is_collection,sort_order
        FROM md_flow_interview_records WHERE tenant_id=$1 AND run_id=$2 ORDER BY api_name,sort_order`,
      [tenantId,runId]);
      const recordGroups=new Map<string,{objectApi:string;collection:boolean;
        rows:Array<{recordId:string|null;values:Record<string,Scalar>}>}>();
      for(const row of persistedRecords.rows){
        const group=recordGroups.get(row.api_name)??{
          objectApi:row.object_api,collection:row.is_collection,rows:[]
        };
        if(group.objectApi!==row.object_api||group.collection!==row.is_collection)
          throw new Error('Invalid persisted Flow record resource');
        group.rows.push({recordId:row.record_id,values:Object.create(null) as Record<string,Scalar>});
        recordGroups.set(row.api_name,group);
      }
      const persistedFields=await client.query<{
        api_name:string;sort_order:number;field_api:string;value_text:string|null;data_type:string
      }>(`SELECT api_name,sort_order,field_api,value_text,data_type
        FROM md_flow_interview_record_fields WHERE tenant_id=$1 AND run_id=$2`,
      [tenantId,runId]);
      for(const field of persistedFields.rows){
        const row=recordGroups.get(field.api_name)?.rows[field.sort_order];
        if(!row)throw new Error('Invalid persisted Flow record field');
        row.values[field.field_api]=scalarFrom(field.value_text,field.data_type);
      }
      for(const [name,group] of recordGroups){
        if(group.collection&&group.rows.length===1&&!group.rows[0].recordId
          &&Object.keys(group.rows[0].values).length===0){
          vars[name]=[];
          continue;
        }
        const found=await Promise.all(group.rows.map(async row=>{
          const record=row.recordId&&!['$Record','$Record__Prior'].includes(name)
            ?await this.records!.get(tenantId,userId,group.objectApi,row.recordId):{};
          if(row.recordId&&['$Record','$Record__Prior'].includes(name))row.values.Id=row.recordId;
          return {...record,...row.values};
        }));
        vars[name]=group.collection?found:found[0]??null;
      }
      const readableRecordFields=new Set(['Id','CreatedAt','LastModifiedDate']);
      const triggerObjectApi=recordGroups.get('$Record')?.objectApi;
      if(active.flow_type==='Record-Triggered Flow'&&triggerObjectApi){
        const {rows:fields}=await client.query<{api_name:string}>(
          `SELECT api_name FROM md_field_definitions
           WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL ORDER BY api_name`,
          [tenantId,triggerObjectApi]);
        const decisions=await this.rbac!.allowedMany(tenantId,actor.actorUserId,
          fields.map(field=>({resource:triggerObjectApi+'.'+field.api_name,action:'read'})));
        fields.forEach((field,index)=>{if(decisions[index])readableRecordFields.add(field.api_name);});
        const currentRecord=vars.$Record;
        const recordTypeId=currentRecord&&typeof currentRecord==='object'
          ?(currentRecord as Record<string,unknown>).RecordTypeId:null;
        if(typeof recordTypeId==='string'&&await this.rbac!.allowed(tenantId,actor.actorUserId,
          'RecordType:'+triggerObjectApi+'.'+recordTypeId,'read'))
          readableRecordFields.add('RecordTypeId');
      }
      if(/\$RecordType(?:\.|\b)/.test(JSON.stringify([graph.resources,graph.elements]))){
        if(active.flow_type!=='Record-Triggered Flow'||!triggerObjectApi)
          throw new Error('$RecordType is only available in Record-Triggered Flows');
        const currentRecord=vars.$Record;
        const recordTypeId=currentRecord&&typeof currentRecord==='object'
          ?(currentRecord as Record<string,unknown>).RecordTypeId:null;
        if(typeof recordTypeId!=='string'){
          vars.$RecordType={Id:null,Name:null,DeveloperName:null};
        }else{
          const {rows:types}=await client.query<{record_type_id:string;label:string;
            developer_name:string}>(`SELECT record_type_id,label,developer_name
            FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2
              AND record_type_id=$3 AND active=true`,
          [tenantId,triggerObjectApi,recordTypeId]);
          if(!types[0])throw new Error('Flow record type is unavailable');
          await this.rbac!.require(tenantId,actor.actorUserId,
            'RecordType:'+triggerObjectApi+'.'+recordTypeId,'read');
          vars.$RecordType={Id:types[0].record_type_id,Name:types[0].label,
            DeveloperName:types[0].developer_name};
        }
      }
      const currentFormulaRecord=vars.$Record&&typeof vars.$Record==='object'
        &&!Array.isArray(vars.$Record)?vars.$Record as Record<string,unknown>:null;
      const priorFormulaRecord=vars.$Record__Prior&&typeof vars.$Record__Prior==='object'
        &&!Array.isArray(vars.$Record__Prior)
        ?vars.$Record__Prior as Record<string,unknown>:null;
      const formulaRecordType=vars.$RecordType&&typeof vars.$RecordType==='object'
        &&!Array.isArray(vars.$RecordType)
        ?vars.$RecordType as FormulaEvaluationContext['recordType']:undefined;
      formulaContext=createFormulaEvaluationContext({
        ...formulaContext,transactionStage:'flow',isClone:vars.$Record__IsClone===true,
        ...(currentFormulaRecord?{currentRecord:currentFormulaRecord}:{}),
        ...(priorFormulaRecord?{priorRecord:priorFormulaRecord}:{}),
        ...(formulaRecordType?{recordType:formulaRecordType}:{})
      });
      const resources=Array.isArray(graph.resources)
        ?graph.resources as Array<{name:string;type:string;dataType:string;value?:unknown}>:[];
      const persistenceResources=[...resources];
      for(const element of elements){
        const objectApi=String(element.config.object??'');
        const output=element.type==='Get Records'
          ?typeof element.config.outputVariable==='string'&&element.config.outputVariable
            ?element.config.outputVariable:'record'+element.id
          :['Create Records','CreateRecord'].includes(element.type)
            ?element.config.recordSource==='collection'
              ?typeof element.config.resultVariable==='string'?element.config.resultVariable:''
              :'record'+element.id
            :'';
        if(!output||resources.some(resource=>resource.name===output)
          ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi))continue;
        const collection=element.type==='Get Records'
          ?element.config.recordLimit==='all'||Number(element.config.recordLimit??1)>1
          :element.config.recordSource==='collection';
        persistenceResources.push({name:output,type:collection?'Record Collection':'Record',dataType:objectApi});
      }
      // Reuse any correctly declared Loop Record rather than rejecting it.
      persistenceResources.push(...resolveFlowLoopResources(elements,resources));
      const formulaDefinitions=new Map(resources.filter(resource=>resource.type==='Formula')
        .map(resource=>[resource.name,resource]));
      const preparedFormulas=new Set<string>(),preparingFormulas=new Set<string>();
      const resolveResource=(reference:string):unknown=>{
        const separator=reference.indexOf('.');
        const name=separator<0?reference:reference.slice(0,separator);
        const field=separator<0?undefined:reference.slice(separator+1);
        if(reference==='$User.Id')return userId;
        // Fault paths store the failed step's error as flat $Flow.* values.
        if(/^\$Flow\.Fault(?:Message|Code)$/.test(reference))
          return Object.hasOwn(vars,reference)?vars[reference]:null;
        if(!Object.hasOwn(vars,name)){
          if(name==='$Record__Prior'){
            if(active.flow_type!=='Record-Triggered Flow')
              throw new Error('$Record__Prior is only available in Record-Triggered Flows');
            return null;
          }
          const resource=resources.find(item=>item.name===name);
          if(!resource)throw new Error('Unknown Flow resource: '+name);
          if(resource.type==='Formula')
            throw new Error('Flow formula resource requires SQL preparation: '+name);
          if(resource.type==='Constant'||resource.type==='Choice'){
            const value=resource.value??null;
            if(['Number','Currency','Percent'].includes(resource.dataType)){
              const parsed=typeof value==='number'?value:Number(value);
              if(!Number.isFinite(parsed))throw new Error('Invalid Flow constant: '+name);
              vars[name]=parsed;
            }else if(['Boolean','Checkbox'].includes(resource.dataType)){
              if(typeof value==='boolean')vars[name]=value;
              else if(value==='true'||value==='false')vars[name]=value==='true';
              else throw new Error('Invalid Flow constant: '+name);
            }else if(scalar(value))vars[name]=value;
            else throw new Error('Invalid Flow constant: '+name);
          }else if(resource.type==='Text Template'){
            if(typeof resource.value!=='string')throw new Error('Flow text template has no text: '+name);
            vars[name]=resource.value.replace(/\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/g,
              (_match,token:string)=>{
                const value=resolveResource(token);
                if(value!==null&&value!==undefined&&!scalar(value))
                  throw new Error('Text template references a non-scalar resource');
                return value===null||value===undefined?'':String(value);
              });
          }else throw new Error('Unknown Flow resource: '+name);
        }
        const value=vars[name];
        if(field===undefined)return value;
        if(!value||typeof value!=='object'||Array.isArray(value))
          throw new Error('Flow field reference needs a single record');
        if(['$Record','$Record__Prior'].includes(name)){
          if(!readableRecordFields.has(field))throw new Error('Permission denied');
          if(!Object.hasOwn(value,field))return null;
        }
        if(!Object.hasOwn(value,field)){
          if(name==='$Record__Prior')return null;
          throw new Error('Unknown Flow record field: '+field);
        }
        return (value as Record<string,unknown>)[field];
      };
      /** Materialize only Formula resources referenced by the next node.
       * The node APIs remain synchronous, while selected scalar functions run
       * inside the existing authenticated Flow SQL transaction. */
      const prepareFormula=async(name:string):Promise<void>=>{
        if(preparedFormulas.has(name))return;
        const resource=formulaDefinitions.get(name);
        if(!resource)return;
        if(preparingFormulas.has(name))
          throw new Error('Circular Flow formula reference: '+name);
        if(typeof resource.value!=='string')
          throw new Error('Flow formula resource has no expression: '+name);
        preparingFormulas.add(name);
        try{
          for(const reference of flowFormulaReferences(resource.value)){
            const first=reference.split('.')[0];
            if(formulaDefinitions.has(first))await prepareFormula(first);
          }
          const formulaResult=await evaluateResolvedFormulaSql(
            client,resource.value,resolveResource,
            {...formulaContext,isClone:vars.$Record__IsClone===true},'flow_formula');
          const result=isFormulaImageResult(formulaResult)?formulaResult.url:formulaResult;
          if(['Number','Currency','Percent'].includes(resource.dataType)){
            if(typeof result!=='number'||!Number.isFinite(result))
              throw new Error('Flow formula did not return a finite number: '+name);
          }else if(['Boolean','Checkbox'].includes(resource.dataType)&&typeof result!=='boolean')
            throw new Error('Flow formula did not return a Boolean: '+name);
          else if(!['Boolean','Checkbox','Number','Currency','Percent'].includes(resource.dataType)
            &&result!==null&&typeof result!=='string')
            throw new Error('Flow formula did not return text: '+name);
          vars[name]=result;
          preparedFormulas.add(name);
        }finally{preparingFormulas.delete(name);}
      };
      const prepareNodeFormulas=async(node:{type:string;config:Record<string,unknown>}):Promise<void>=>{
        // Formula resources are not durable variables: recalculate after changes.
        for(const name of formulaDefinitions.keys())delete vars[name];
        preparedFormulas.clear();
        const sources=[JSON.stringify(node.config)];
        for(const template of resources.filter(item=>item.type==='Text Template')){
          if(sources.some(source=>source.includes(template.name)))
            sources.push(String(template.value??''));
        }
        for(const name of formulaDefinitions.keys()){
          const used=sources.some(source=>source.includes('@'+name)
            ||source.includes('{!'+name)||source.includes('"'+name+'"'));
          if(used||node.type==='End'&&resources.some(item=>
            item.name===name&&(item as {availableForOutput?:boolean}).availableForOutput===true))
            await prepareFormula(name);
        }
      };
      const evaluate=(value:unknown):unknown=>{
        if(!scalar(value))throw new Error('Unsupported Flow expression value');
        if(typeof value!=='string')return value;
        const reference=value.match(/^\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}$/)
          ??value.match(/^@([A-Za-z_$][A-Za-z0-9_$.]*)$/);
        return reference?resolveResource(reference[1]):value;
      };
      const set=(key:unknown,value:Scalar)=>{
        if(typeof key==='string'){
          const recordField=/^\$Record\.([A-Za-z][A-Za-z0-9_]*)$/.exec(key);
          if(recordField){
            const record=vars.$Record;
            if(active.flow_type!=='Record-Triggered Flow'||start[0].config.runWhen!=='before-save'
              ||!record||typeof record!=='object'||Array.isArray(record))
              throw new Error('Assignments to $Record fields require a before-save Record-Triggered Flow');
            (record as Record<string,unknown>)[recordField[1]]=value;
            return;
          }
        }
        if(typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))
          throw new Error('Invalid Flow variable name');
        vars[key]=value;
      };
      let current=state.current_element;
      let history=[...state.history_elements];
      let steps=state.step_count;
      if(request.action==='back'){
        if(!history.length)throw new Error('No previous Screen');
        current=history.pop()!;
        await client.query(`UPDATE md_flow_interview_state SET current_element=$3,history_elements=$4,
          updated_at=now() WHERE tenant_id=$1 AND run_id=$2`,[tenantId,runId,current,history]);
        const screen=byId.get(current);
        if(!screen||screen.type!=='Screen')throw new Error('Invalid Screen history');
        const screenPayload=screenRecordPayload(screen,vars,persistenceResources);
        return {interviewId:runId,screen:hydrateFlowScreenChoices(screen,resources),outcomes:this.screenOutcomes(screen),
          canGoBack:history.length>0,...screenPayload};
      }
      const visible=byId.get(current);
      const values=request.values??{};
      if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('Invalid Screen values');
      if(visible?.type==='Screen'&&persisted.rows[0]){
        const fields=Array.isArray(visible.config.fields)?visible.config.fields as Array<Record<string,unknown>>:[];
        const hydrated=hydrateFlowScreenChoices(visible,resources);
        const choiceFields=Array.isArray(hydrated.config.fields)
          ?hydrated.config.fields as Array<Record<string,unknown>>:[];
        const allowed=new Set(fields.map(field=>field.apiName).filter((key):key is string=>typeof key==='string'));
        for(const [key,value] of Object.entries(values)){
          const field=choiceFields.find(item=>item.apiName===key);
          if(field?.type==='Picklist'){
            const choices=Array.isArray(field.choices)?field.choices:[];
            if(value!==''&&value!==null&&value!==undefined
              &&(typeof value!=='string'||!choices.includes(value)))
              throw new Error('Invalid Screen choice for field: '+key);
          }
          if(!allowed.has(key)){
            // The UI may echo previously returned Flow resource values; never let
            // a Screen silently overwrite variables it does not own.
            if(Object.hasOwn(vars,key)&&vars[key]===value)continue;
            throw new Error('Invalid Screen field: '+key);
          }
          const selected=await acceptScreenRecordSelection(field??{},value,vars,persistenceResources,
            (objectApi,id)=>this.records!.get(tenantId,userId,objectApi,id));
          if(!selected){
            if(!scalar(value)||typeof value==='string'&&value.length>4096)
              throw new Error('Invalid Screen field: '+key);
            set(key,value);
          }
        }
        for(const field of fields){
          const key=field.apiName;
          if(typeof key==='string'&&field.required===true){
            const output=typeof field.selectedRowsResource==='string'&&field.selectedRowsResource
              ?field.selectedRowsResource:key;
            const collection=persistenceResources.some(item=>item.name===output
              &&item.type==='Record Collection') ? vars[output]:undefined;
            if(Array.isArray(collection)?collection.length===0
              :vars[key]===undefined||vars[key]===null||vars[key]==='')
              throw new Error('Required Screen field: '+key);
          }
        }
        history.push(current);
        if(history.length>25)throw new Error('Screen history exceeded limit');
        const choices=this.screenOutcomes(visible);
        if(request.outcome!==undefined && !choices.some(choice=>
          choice.name===request.outcome||choice.label===request.outcome))
          throw new Error('Invalid Screen outcome');
        const option=choices.find(choice=>choice.name===request.outcome||choice.label===request.outcome);
        const next=connectors.find(edge=>edge.from===current&&edge.kind==='normal'
          &&(edge.label===option?.label||edge.label===option?.name
          ||(!option&&(!edge.label||edge.label==='Default'||edge.label==='Next'))));
        if(!next)throw new Error('Screen outcome is not connected');
        current=next.to;
      }
      const rollbackSavepoint='flow_start_'+runId.replace(/-/g,'');
      await client.query('SAVEPOINT '+rollbackSavepoint);
      for(;steps<200;steps++){
        const node=byId.get(current);
        if(!node)throw new Error('Invalid Flow graph target');
        await prepareNodeFormulas(node);
        let selected:string|undefined;
        if(node.type==='Screen')return executeScreenElementNode({
          client,tenantId,runId,current,history,steps,loopIndexes,vars,node,resources,persistenceResources,
          flowType:active.flow_type,outcomes:this.screenOutcomes(node)
        });
        if(node.type==='End'){
          await client.query("UPDATE md_flow_runs SET status='completed',finished_at=now(),wait_until=NULL WHERE tenant_id=$1 AND id=$2",[tenantId,runId]);
          const resources=Array.isArray(graph.resources)
            ?graph.resources as Array<{name:string;availableForOutput:boolean;type?:string}>:[];
          const outputs:Record<string,unknown>={};
          for(const resource of resources)
            if(resource.availableForOutput){
              if(Object.hasOwn(vars,resource.name))outputs[resource.name]=vars[resource.name];
              else if(['Formula','Constant','Choice','Text Template'].includes(resource.type??''))
                outputs[resource.name]=resolveResource(resource.name);
            }
          const completion={id:runId,status:'completed' as const,completed:true,outputs};
          if (typeof vars.requestId==='string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vars.requestId))
            await FlowExecutionRequests.completeRun(client,tenantId,runId,completion);
          if(active.flow_type==='Record-Triggered Flow')return {...completion,record:vars.$Record};
          return completion;
        }
        if(node.type==='Assignment'){
          executeFlowAssignment({node,resources:persistenceResources,vars,evaluate,set});
        }else if(node.type==='Decision'){
          selected=executeDecisionNode({node,flowType:active.flow_type,vars,evaluate});
        }else if(['Get Records','Update Records','Delete Records','Loop','Collection Filter',
          'Collection Sort','Transform','Parse JSON','Get Context','Set Context','Clear Context','Create Records','CreateRecord','Get Available Slots'].includes(node.type)){
          if(active.flow_type==='Record-Triggered Flow'&&start[0].config.runWhen==='before-save'
             &&!['Get Records','Loop','Collection Filter','Collection Sort','Transform'].includes(node.type))
            throw new Error('Before-save Flows allow read-only data elements only');
          if(!this.records||!this.recordQuery)throw new Error('Flow record engine unavailable');
          let action;
          const savepoint='flow_action_'+node.id;
          await client.query('SAVEPOINT '+savepoint);
          try {
            action=await executeFlowDataAction({tenantId,userId,client,node,records:this.records,
              recordQuery:this.recordQuery,vars,loops:loopIndexes,evaluate,set});
            await client.query('RELEASE SAVEPOINT '+savepoint);
          }catch(error){
            await client.query('ROLLBACK TO SAVEPOINT '+savepoint);
            await client.query('RELEASE SAVEPOINT '+savepoint);
            const fault=connectors.find(edge=>edge.from===current&&edge.kind==='fault');
            if(!fault)throw error;
            vars['$Flow.FaultMessage']=error instanceof Error?error.message:'Unknown Flow error';
            vars['$Flow.FaultCode']=error instanceof Error?error.name:'UNKNOWN';
            current=fault.to;
            history=[];
            continue;
          }
          if(action.clearHistory)history=[];
          selected=action.selected;
        }else if(node.type==='Subflow'){
          const savepoint='flow_subflow_'+node.id;
          await client.query('SAVEPOINT '+savepoint);
          try{
            await executeFlowSubflow({client,tenantId,userId,
              initiatingUserId:active.initiated_by??userId,config:node.config,
              parentResources:resources,
              rbac:this.rbac!,callStack:activeCallStack,evaluate,
              set:(name,value)=>set(name,value),
              advance:async(childRunId,childCallStack,childUserId)=>{
                const result=await this.advanceInterview(tenantId,childUserId??userId,
                  childRunId,{},client,childCallStack);
                return 'status' in result?result:{status:'waiting'};
              }});
            await client.query('RELEASE SAVEPOINT '+savepoint);
          }catch(error){
            await client.query('ROLLBACK TO SAVEPOINT '+savepoint);
            await client.query('RELEASE SAVEPOINT '+savepoint);
            const fault=connectors.find(edge=>edge.from===current&&edge.kind==='fault');
            if(!fault)throw error;
            vars['$Flow.FaultMessage']=error instanceof Error?error.message:'Unknown Flow error';
            vars['$Flow.FaultCode']=error instanceof Error?error.name:'UNKNOWN';
            current=fault.to;
            history=[];
            continue;
          }
          history=[];
        }else if(node.type==='HTTP Callout'){
          const fault=connectors.find(edge=>edge.from===current&&edge.kind==='fault');
          const faultTo=await executeHttpCalloutNode({
            transport:this.httpCallout,tenantId,userId,client,runId,node,current,vars,evaluate,set,
            resources,faultTarget:fault?.to
          });
          if(faultTo!==undefined){current=faultTo;history=[];continue;}
          history=[];
        }else if(node.type==='Orchestration Stage'){
          if(active.flow_type!=='Flow Orchestration')
            throw new Error('Approval stages require a Flow Orchestration');
          const {rows:existing}=await client.query<{status:string;group_id:string}>(`
            SELECT status,group_id FROM md_flow_approval_stages
            WHERE tenant_id=$1 AND run_id=$2 AND element_id=$3 FOR UPDATE
          `,[tenantId,runId,current]);
          if(existing[0]){
            if(!['Approved','Rejected'].includes(existing[0].status))
              throw new Error('Orchestration stage is still awaiting a decision');
            selected=existing[0].status;
            const output=node.config.statusVariable;
            if(output)set(output,selected);
          }else{
            if(!this.records)throw new Error('Flow Record Engine is unavailable');
            if(!['ANY','ALL'].includes(String(node.config.approvalMode??'ANY')))
              throw new Error('Invalid orchestration approval rule');
            const groupId=await submitFlowStageApproval({
              client,rbac:this.rbac!,tenantId,userId,flowApi:active.api_name,
              config:{...node.config,actionType:'Submit for Approval'},resolve:evaluate,
              variables:vars,records:this.records,connectors:[],elementId:current,runId});
            await client.query(`
              INSERT INTO md_flow_approval_stages
              (tenant_id,run_id,element_id,group_id,rule)
              VALUES($1,$2,$3,$4,$5)
            `,[tenantId,runId,current,groupId,node.config.approvalMode??'ANY']);
            await persistFlowInterviewPause(client,tenantId,runId,current,history,steps+1,
              loopIndexes,vars,persistenceResources);
            await client.query(`
              UPDATE md_flow_runs
              SET status='waiting',wait_kind='orchestration',wait_until=NULL
              WHERE tenant_id=$1 AND id=$2 AND status='pending'
            `,[tenantId,runId]);
            return {interviewId:runId,status:'waiting',kind:'orchestration'};
          }
        }else if(node.type==='Action'&&node.config.actionType==='Outbound Message'){
          if(!this.httpCallout)throw new Error('Outbound Message transport unavailable');
          const stableKey=runId+'-'+node.id;
          const scalarVars=Object.fromEntries(Object.entries(vars).filter(
            (entry):entry is [string,Scalar]=>scalar(entry[1])));
          // The named provider chooses the external transport; no hardcoded SMS/WhatsApp adapter.
          const transport={...node.config,method:'POST',
            deliveryMode:node.config.deliveryMode??'DURABLE_ASYNC'};
          const asynchronous=transport.deliveryMode==='DURABLE_ASYNC';
          try{
            await this.httpCallout(tenantId,userId,transport,scalarVars,stableKey,
              asynchronous?{client,runId,nodeId:current}:undefined);
          }catch(error){
            const fault=connectors.find(edge=>edge.from===current&&edge.kind==='fault');
            if(!fault)throw error;
            vars['$Flow.FaultMessage']=error instanceof Error?error.message:'Unknown Flow error';
            vars['$Flow.FaultCode']=error instanceof Error?error.name:'UNKNOWN';
            current=fault.to;history=[];continue;
          }
          history=[];
        }else if(node.type==='Action'||node.type==='Publish Platform Event'){
          const fault=await executeActionButtonNode({client,rbac:this.rbac!,tenantId,userId,
            flowApi:active.api_name,config:node.type==='Publish Platform Event'?{...node.config,actionType:'Publish Platform Event'}:node.config,
            resolve:evaluate,variables:vars,records:this.records!,
            httpCallout:this.httpCallout,
            connectors:connectors.filter(edge=>edge.from===current),elementId:current,
            enqueueEmail:this.queueFlowEmail?message=>this.queueFlowEmail!(
              client,tenantId,userId,active.flow_id,active.version,runId,current,steps,message):undefined,
            runId});
          if(fault!==undefined){current=fault;history=[];continue;}
          history=[];
        }else if(node.type==='Custom Error'){
          executeCustomErrorNode(node.config,reference=>resolveResource(reference));
        }else if(node.type==='Roll Back Records'){
          await executeRollbackRecordsNode(client,rollbackSavepoint);
        }else if(node.type!=='Start'&&node.type!=='Wait'){
          throw new Error('Unsupported Screen Flow action: '+node.type);
        }
        const available=connectors.filter(edge=>edge.from===current&&edge.kind==='normal');
        const next=selected
          ?available.find(edge=>edge.label===selected||edge.label==='Default')
          :available.find(edge=>!edge.label||edge.label==='Default'||edge.label==='Next')??(available.length===1?available[0]:undefined);
        if(!next)throw new Error('Flow element has no supported outgoing connector');
        if(node.type==='Wait')return executeWaitPauseNode({
          client,tenantId,userId,runId,node,nextElement:next.to,history,steps,loopIndexes,vars,
          persistenceResources,flowType:active.flow_type,runWhen:start[0].config.runWhen,
          flowApi:active.api_name,version:active.version,
          appApiName:typeof graph.appApiName==='string'?graph.appApiName:undefined,
          scheduleResume:this.scheduleResume
        });
        current=next.to;
      }
      throw new Error('Flow interview exceeded maximum steps');
    };
    try{return executor?await advance(executor):await this.db.transaction(advance);}
    catch(error){
      if(executor)throw error;
      const message=error instanceof Error?error.message:'Unknown Flow failure';
      // Invalid Screen submissions are retriable client corrections. The
      // transaction has rolled back: keep the interview pending and editable.
      if(error instanceof ScreenSelectionError
        || /^(Required Screen field:|Invalid Screen field:|Invalid Screen outcome$)/.test(message))
        throw error;
      await this.db.query(
        "UPDATE md_flow_runs SET status='failed',error_code=$3,finished_at=now() WHERE tenant_id=$1 AND id=$2 AND status='pending'",
        [tenantId,runId,message.slice(0,200)]);
      throw error;
    }
  }

  /** Server-side read-only debugger: never writes SQL, executes a callout or creates a record. */
  async debugGraph(tenantId:string,userId:string,apiName:string,inputs:unknown,
    recordTriggered=false){
    if(!this.rbac)throw new Error('Flow permissions not configured');
    await this.rbac.require(tenantId,userId,'FlowDefinition','read');
    await this.rbac.require(tenantId,userId,'Flow:'+apiName,'execute');
    if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))
      throw new Error('Invalid Flow debug inputs');
    if(Object.keys(inputs).length>100)throw new Error('Too many Flow debug inputs');
    const version=await this.loadActive(tenantId,apiName);
    const {rows}=await this.db.query<MetadataValueRow>(
      'SELECT property_path,value_kind,value_text FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',
      [tenantId,version.id]);
    let doc=decodeMetadataValues(rows).builder as Record<string,unknown>|undefined;
    if(!doc||!Array.isArray(doc.elements)||!Array.isArray(doc.connectors)){
      // Legacy SQL-only definitions share the same debugger, without a parallel executor.
      const [oldNodes,oldEdges]=await Promise.all([
        this.db.query<{api_name:string;node_type:string}>(`
          SELECT api_name,node_type FROM md_flow_nodes
          WHERE tenant_id=$1 AND flow_id=$2 ORDER BY sort_order,id`,[tenantId,version.id]),
        this.db.query<EdgeRow>(`
          SELECT source_api,target_api,outcome FROM md_flow_edges
          WHERE tenant_id=$1 AND flow_id=$2`,[tenantId,version.id])
      ]);
      const idOf=new Map(oldNodes.rows.map((node,index)=>[node.api_name,index+1]));
      doc={
        flowType:'Autolaunched Flow',
        elements:oldNodes.rows.map((node,index)=>({
          id:index+1,type:node.node_type,label:node.api_name,config:{}
        })),
        connectors:oldEdges.rows.filter(edge=>idOf.has(edge.source_api)&&idOf.has(edge.target_api))
          .map((edge,index)=>({
            id:'edge-'+index,from:idOf.get(edge.source_api),to:idOf.get(edge.target_api),
            label:edge.outcome,kind:'normal'
          }))
      };
    }
    const userResource:Record<string,unknown>={};
    const formulaContext=await loadFlowUserResource(this.db,tenantId,userId,
      JSON.stringify([doc.resources,doc.elements]),userResource,this.rbac);
    return simulateFlowGraph({
      apiName,version:version.version,flowType:String(doc.flowType??'Autolaunched Flow'),
      nodes:doc.elements as Array<{id:number;type:string;label:string;config:Record<string,unknown>}>,
      edges:doc.connectors as Array<{from:number;to:number;label:string;kind:string}>,
      inputs,recordTriggered,resources:flowDebugResources(doc.resources),
      formulaContext,userResource:Object.keys(userResource).length?userResource.$User as
        Record<string,unknown>:undefined,
      evaluateSql:(source,resolve,context)=>evaluateResolvedFormulaSql(
        this.db,source,resolve,context,'flow_formula'),
      findRecords:this.recordQuery
        ?(object,conditions,logic,options)=>
          this.recordQuery!.find(tenantId,userId,object,conditions,logic,options)
        :undefined
    });
  }

  private screenOutcomes(node:{config:Record<string,unknown>}) {
    const raw=Array.isArray(node.config.outcomes)?node.config.outcomes:[];
    const result=(raw as Array<Record<string,unknown>>).filter(item=>
      typeof item.name==='string'&&typeof item.label==='string')
      .map(item=>({name:item.name as string,label:item.label as string}));
    return result.length?result:[{name:'Default',label:'Next'}];
  }

  async run(tenantId:string,runId:string,userId:string) {
    if(!this.rbac||!this.records)throw new Error('Flow executor not configured');
    try {
      const outcome=await this.db.transaction(async client=>{
        const row=await client.query<{flow_id:string;started_by:string;status:string;api_name:string}>(
          "SELECT r.flow_id,r.started_by,r.status,f.api_name FROM md_flow_runs r JOIN md_flow_definitions f ON f.id=r.flow_id AND f.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r",
          [tenantId,runId]);
        const run=row.rows[0];
        if(!run||run.status!=='pending'||run.started_by!==userId)throw new Error('Invalid Flow run');
        await this.rbac!.require(tenantId,userId,'Flow:'+run.api_name,'execute');
        const [nodeResults,edgeResults,propResults,inputResults]=await Promise.all([
          client.query<NodeRow>('SELECT id,api_name,node_type FROM md_flow_nodes WHERE tenant_id=$1 AND flow_id=$2 ORDER BY sort_order,id',[tenantId,run.flow_id]),
          client.query<EdgeRow>('SELECT source_api,target_api,outcome FROM md_flow_edges WHERE tenant_id=$1 AND flow_id=$2',[tenantId,run.flow_id]),
          client.query<PropRow>('SELECT p.node_id,p.api_name,p.value_text,p.data_type FROM md_flow_node_properties p JOIN md_flow_nodes n ON n.id=p.node_id AND n.tenant_id=p.tenant_id WHERE n.tenant_id=$1 AND n.flow_id=$2',[tenantId,run.flow_id]),
          client.query<{api_name:string;value_text:string|null;data_type:string}>(
            'SELECT api_name,value_text,data_type FROM md_flow_run_inputs WHERE tenant_id=$1 AND run_id=$2',[tenantId,runId])
        ]);
        const nodes=new Map(nodeResults.rows.map(node=>[node.api_name,node]));
        const starts=nodeResults.rows.filter(node=>node.node_type==='Start');
        if(starts.length!==1)throw new Error('Invalid Flow: exactly one Start required');
        if(nodes.size!==nodeResults.rows.length)throw new Error('Invalid Flow duplicate node');
        const edges=edgeResults.rows;
        if(edges.some(e=>!nodes.has(e.source_api)||!nodes.has(e.target_api)))
          throw new Error('Invalid Flow graph target');
        const props=new Map<string,Map<string,NodeProperty>>();
        for(const prop of propResults.rows) {
          const map=props.get(prop.node_id)??new Map<string,NodeProperty>();
          map.set(prop.api_name,{value_text:prop.value_text,data_type:prop.data_type});
          props.set(prop.node_id,map);
        }
        const vars=new Map<string,Scalar>();
        for(const input of inputResults.rows)vars.set(input.api_name,scalarFrom(input.value_text,input.data_type));
        const resolve=(value:NodeProperty|undefined):Scalar=>{
          if(!value)throw new Error('Missing Flow property');
          if(value.value_text?.startsWith('@')) {
            const name=value.value_text.slice(1);
            if(!namePattern.test(name)||!vars.has(name))throw new Error('Unknown Flow resource');
            return vars.get(name)!;
          }
          return scalarFrom(value.value_text,value.data_type);
        };
        const property=(node:NodeRow,key:string)=>props.get(node.id)?.get(key);
        const requireText=(value:Scalar)=>{
          if(typeof value!=='string'||!namePattern.test(value))throw new Error('Invalid Flow API name');
          return value;
        };
        let current=starts[0].api_name;
        for(let step=0;step<200;step++) {
          const node=nodes.get(current)!;
          let result='default';
          switch(node.node_type) {
            case 'Start': break;
            case 'Assignment': {
              const dest=requireText(resolve(property(node,'variable')));
              vars.set(dest,resolve(property(node,'value')));
              break;
            }
            case 'Decision': {
              const left=resolve(property(node,'actual'));
              const right=resolve(property(node,'expected'));
              const operator=property(node,'operator')?.value_text??'equals';
              const matches=evaluateFlowDecisionComparison(left,right,operator);
              result=matches?'true':'false';
              break;
            }
            case 'CreateRecord': {
              const objectApi=requireText(resolve(property(node,'objectApi')));
              const fields:Record<string,unknown>={};
              for(const [key,value] of props.get(node.id)??new Map<string,NodeProperty>()) {
                if(key.startsWith('field.')) {
                  const fieldName=key.slice(6);
                  if(!namePattern.test(fieldName)||fieldName.includes('.'))throw new Error('Invalid Flow field');
                  fields[fieldName]=resolve(value);
                }
              }
              const recordId=await this.records!.createInTransaction(client,tenantId,userId,objectApi,fields);
              const output=property(node,'resultVariable');
              if(output)vars.set(requireText(resolve(output)),recordId);
              break;
            }
            case 'End': {
              await client.query(
                "UPDATE md_flow_runs SET status='completed',finished_at=now() WHERE tenant_id=$1 AND id=$2",
                [tenantId,runId]);
              const outputs:Record<string,Scalar>={};
              for(const [key,value] of props.get(node.id)??new Map<string,NodeProperty>()) {
                if(!key.startsWith('output.'))continue;
                const outputName=key.slice(7);
                if(!namePattern.test(outputName)||['__proto__','prototype','constructor'].includes(outputName))
                  throw new Error('Invalid Flow output');
                outputs[outputName]=resolve(value);
              }
              return {id:runId,status:'completed' as const,...(Object.keys(outputs).length?{outputs}:{})};
            }
            default:throw new Error('Unsupported Flow element: '+node.node_type);
          }
          const next=edges.find(e=>e.source_api===current&&e.outcome===result);
          if(!next)throw new Error('Invalid Flow: no outgoing path');
          current=next.target_api;
        }
        throw new Error('Flow exceeded maximum element limit');
      });
      return outcome;
    } catch(error) {
      // Mutations within the transaction were rolled back. The run is durable and failed.
      const message=error instanceof Error?error.message:'Unknown Flow failure';
      await this.db.query(
        "UPDATE md_flow_runs SET status='failed',error_code=$3,finished_at=now() WHERE tenant_id=$1 AND id=$2 AND status='pending'",
        [tenantId,runId,message.slice(0,200)]);
      throw error;
    }
  }
}

// Preserve the canonical Flow Engine name alongside the legacy FlowRuntime export.
export {FlowRuntime as FlowEngineCore};
