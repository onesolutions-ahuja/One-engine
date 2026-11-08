import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlExecutor,SqlPersistence} from '../system-files/sql-persistence.js';
import {validateFlowResources} from '../system-files/flow-formula-runtime.js';
import {resolveFlowLocalDateTime,resolveFlowWaitUntil} from '../system-files/flow-wait-runtime.js';
import type {FlowCapabilityCatalog} from '../system-files/flow-capability-catalog.js';
import {resolveFlowIntegrationCallout} from '../system-files/flow-integration-connection.js';
import {parseFlowHttpMapping} from '../system-files/flow-http-mapping.js';
import {hydrateFlowScreenChoices} from '../system-files/flow-screen-choice-runtime.js';
import {validateScreenRecordBindings} from '../system-files/flow-screen-record-selection.js';
import {validateTriggerDependencies,orderTriggeredFlows} from './record-trigger-dependencies.js';
import {decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';

export async function flowAppIsEntitled(db:SqlExecutor,tenantId:string,appApiName:string|null) {
 if(appApiName===null)return true;
 if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(appApiName))return false;
 const {rows}=await db.query(`
  SELECT 1 FROM md_apps a
  JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
  JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1
  WHERE a.api_name=$2 AND a.enabled=true AND e.active=true
   AND (e.expires_at IS NULL OR e.expires_at>now())
   AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)`,
  [tenantId,appApiName]);
 return rows.length>0;
}

export async function validateFlowDraft(rbac:RbacEngine|undefined,tenantId:string,userId:string,
  apiName:string,draft:unknown,db?:SqlPersistence,capabilities:FlowCapabilityCatalog|null=null) {
 if(!rbac)throw new Error('Flow permissions not configured');
 await rbac.require(tenantId,userId,'FlowDefinition','manage');
 if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName))throw new Error('Invalid Flow name');
 if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('Invalid Flow draft');
 const data=draft as Record<string,unknown>;
 const errors:string[]=[],warnings:string[]=[];
 if(data.appApiName!==undefined&&data.appApiName!==null
  &&(typeof data.appApiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(data.appApiName)))
  errors.push('Flow app identity is invalid');
 const decisionOperators=new Set([
  'equals','notequals','greaterthan','greaterthanorequalto','lessthan','lessthanorequalto',
  'isnull','isnotnull','contains','startswith','endswith','doesnotcontain','notcontains','ischanged','wasset'
 ]);
 const screenVisibilityOperators=new Set([
  'Equals','Not Equals','Not Equal To','Does Not Equal','Greater Than',
  'Greater Than or Equal','Greater Than or Equal To','Less Than',
  'Less Than or Equal','Less Than or Equal To','Is Null',
  'Is Not Null','Contains','Does Not Contain','Starts With','Includes'
 ]);
 const normalizeOperator=(value:unknown)=>String(value??'Equals').trim().toLowerCase().replace(/[\s_-]+/g,'');
 const validConditionList=(value:unknown,recordTrigger:boolean,location:string,
  fieldPattern?:RegExp)=>{
  if(value===undefined)return;
  if(!Array.isArray(value)||value.length>50){errors.push(location+' must contain at most 50 conditions');return;}
  for(const raw of value){
   if(!raw||typeof raw!=='object'||Array.isArray(raw)){
    errors.push(location+' contains an invalid condition');continue;
   }
   const condition=raw as Record<string,unknown>,operator=normalizeOperator(condition.operator);
   if(!decisionOperators.has(operator)){errors.push(location+' contains an unsupported operator');continue;}
   if(typeof condition.field!=='string'||!condition.field.trim())
    errors.push(location+' conditions require a field or resource');
   else if(fieldPattern&&!fieldPattern.test(condition.field))
    errors.push(location+' conditions require a valid record field');
   if(['ischanged','wasset'].includes(operator)){
    if(!recordTrigger)errors.push(operator==='ischanged'
     ?'Is Changed is supported only in Record-Triggered Flows'
     :'Was Set is supported only in Record-Triggered Flows');
    if(condition.value!==undefined&&condition.value!=='')
     errors.push(operator==='ischanged'?'Is Changed does not accept a comparison value'
      :'Was Set does not accept a comparison value');
   }else if(!['isnull','isnotnull'].includes(operator)
     &&!Object.hasOwn(condition,'value'))
    errors.push(location+' comparison requires a value');
  }
 };
 const startNode=Array.isArray(data.elements)
  ?data.elements.find(item=>item&&typeof item==='object'&&!Array.isArray(item)
    &&(item as Record<string,unknown>).type==='Start') as Record<string,unknown>|undefined
  :undefined;
 const startConfig=startNode?.config&&typeof startNode.config==='object'
  &&!Array.isArray(startNode.config)?startNode.config as Record<string,unknown>:{};
 const beforeSave=data.flowType==='Record-Triggered Flow'&&startConfig.runWhen==='before-save';
 const catalogType=capabilities?.flowTypes.find(type=>type.type===data.flowType);
 if(data.flowType==='In-Screen Flow'){
  const exposed=startConfig.windowPageBindings;
  const availableInputs=new Set(Array.isArray(data.resources)
   ?(data.resources as Array<{name?:unknown;availableForInput?:unknown}>)
     .filter(item=>item.availableForInput===true).map(item=>item.name):[]);
  if(exposed!==undefined&&(!Array.isArray(exposed)||exposed.length>100
   ||new Set(exposed).size!==exposed.length||exposed.some(name=>!availableInputs.has(name))))
   errors.push('Invalid In-Screen page data exposure');
  const bindings=startConfig.inputBindings;
  if(bindings!==undefined){
   const sources=['auto','page.sessionKey','page.apiName','app.apiName',
    'event.recordId','event.componentId','event.name','event.value'];
   const inputNames=new Set(Array.isArray(data.resources)
    ?(data.resources as Array<{name?:unknown;availableForInput?:unknown}>)
      .filter(resource=>resource.availableForInput===true).map(resource=>resource.name):[]);
   if(!bindings||typeof bindings!=='object'||Array.isArray(bindings)
     ||Object.entries(bindings as Record<string,unknown>).some(([name,source])=>
       !inputNames.has(name)||!sources.includes(String(source))))
    errors.push('Invalid In-Screen input binding configuration');
  }
  const windowFields=['windowPageApiName','targetAppApiName','targetPageApiName','launchEventName','platformEventApiName'] as const;
  for(const field of windowFields){
   const value=startConfig[field];
   if(value!==undefined&&(typeof value!=='string'||value.length>128
     ||value!==''&&!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)))
    errors.push('Invalid In-Screen Flow '+field);
  }
  const launch=String(startConfig.launchTrigger??'manual');
  if(!['manual','page-load','component-event','page-updated','platform-event'].includes(launch))
   errors.push('Invalid In-Screen Flow launch trigger');
  if(launch!=='manual'&&!startConfig.targetAppApiName&&!startConfig.targetPageApiName)
   errors.push('Automatic In-Screen Flows require an app or page target');
  if(launch==='platform-event'&&!startConfig.platformEventApiName)
   errors.push('Platform Event trigger requires a published Event name');
  const mode=String(startConfig.windowMode??'modal'),placement=String(startConfig.windowPlacement??'center');
  if(!['modal','drawer','floating','fullscreen'].includes(mode))errors.push('Invalid In-Screen window type');
  if(!['center','top-left','top-right','bottom-left','bottom-right'].includes(placement))
   errors.push('Invalid In-Screen window position');
  for(const [field,min,max] of [['windowWidth',320,1600],['windowHeight',320,1000],['cooldownSeconds',0,3600]] as const){
   const val=startConfig[field];
   if(val!==undefined&&(typeof val!=='number'||!Number.isSafeInteger(val)||val<min||val>max))
    errors.push('Invalid In-Screen Flow '+field);
  }
 }
 const executionContext=startConfig.executionContext??'User';
 if(!['User','System'].includes(String(executionContext)))
  errors.push('Flow execution context must be User or System');
 if(executionContext==='System'&&(['Screen Flow','In-Screen Flow'].includes(String(data.flowType))||beforeSave))
  errors.push('System execution context is not supported for Screen or before-save Record-Triggered Flows');
 if(data.apiName!==apiName)errors.push('Flow API name must match the requested definition');
 if(capabilities?!catalogType?.validateEnabled:!['Autolaunched Flow','Screen Flow','In-Screen Flow',
  'Record-Triggered Flow','Schedule-Triggered Flow','Platform Event-Triggered Flow','Flow Orchestration'].includes(String(data.flowType)))
 errors.push('This SQL runtime supports Autolaunched Flow, Screen Flow, supported Record-Triggered Flows, durable Schedule-Triggered Flows, Platform Event-Triggered Flows and Flow Orchestration');
 errors.push(...validateFlowResources(data.resources,data.flowType==='Record-Triggered Flow'));
 if(!Array.isArray(data.elements)||!Array.isArray(data.connectors))
  return {valid:false,errors:['Flow must contain elements and connectors'],warnings};
 const nodes=data.elements as unknown[],links=data.connectors as unknown[];
 if(nodes.length>250||links.length>500)errors.push('Flow graph exceeds allowed size');
 const ids=new Set<number>(),types=new Map<number,string>();
 for(const item of nodes){
  if(!item||typeof item!=='object'||Array.isArray(item)){errors.push('Invalid Flow element');continue;}
  const node=item as Record<string,unknown>;
  if(typeof node.id!=='number'||!Number.isSafeInteger(node.id)||ids.has(node.id)){
   errors.push('Flow element identifiers must be unique integers');continue;
  }
  ids.add(node.id);
  const type=String(node.type??'');
  types.set(node.id,type);
  const capability=capabilities?.elements.find(item=>item.type===type);
  // Without a SQL connection, isolated validator unit tests retain the legacy contract.
  // Production activate/validate always passes db and fails closed against SQL capabilities.
  const legacyElementAllowed=['Start','Assignment','Decision','Create Records','CreateRecord',
    'HTTP Callout','Action','End','Get Records','Get Available Slots','Update Records','Delete Records','Loop',
    'Collection Filter','Collection Sort','Transform','Parse JSON','Get Context','Set Context','Clear Context','Subflow','Wait','Roll Back Records',
    'Custom Error','Publish Platform Event','Orchestration Stage',
    ...(['Screen Flow','In-Screen Flow'].includes(String(data.flowType))?['Screen']:[])].includes(type);
  if(capabilities?!capability?.allowedFlowTypes.includes(String(data.flowType)):!legacyElementAllowed)
   errors.push('Unsupported SQL Flow element: '+type);
  if(beforeSave&&!(capabilities?capability?.beforeSaveAllowed:
    ['Start','Assignment','Decision','Custom Error','End','Get Records','Loop',
      'Collection Filter','Collection Sort','Transform'].includes(type)))
   errors.push('Before-save Record-Triggered Flows support only read-only data elements, Assignment and Decision');
  if(type==='Wait'&&beforeSave)
   errors.push('Wait elements are not supported in before-save Record-Triggered Flows');
  const config=node.config;
  if(!config||typeof config!=='object'||Array.isArray(config)){
   errors.push('Flow element needs a configuration object: '+node.id);
   continue;
  }
  const properties=config as Record<string,unknown>;
  if(['Get Context','Set Context','Clear Context'].includes(type)){
   if(typeof properties.contextApiName!=='string'
    ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.contextApiName))
    errors.push('Choose a valid Context definition');
   if(type==='Get Context'&&(typeof properties.outputVariable!=='string'
    ||!Array.isArray(data.resources)||!data.resources.some(resource=>{
     if(!resource||typeof resource!=='object'||Array.isArray(resource))return false;
     const candidate=resource as {name?:unknown;type?:unknown;dataType?:unknown};
     return candidate.name===properties.outputVariable&&candidate.type==='Variable'
      &&candidate.dataType==='Text';
    })))errors.push('Get Context requires a declared Text Variable');
   if(type==='Set Context'&&(typeof properties.recordId!=='string'||!properties.recordId.trim()))
    errors.push('Set Context requires a Record Id resource');
  }
  if(type==='Parse JSON'){
   const mappings=properties.assignments;
   const vars=new Set(Array.isArray(data.resources)
    ?data.resources.filter((r):r is {name:string;type:string;dataType:string;isCollection?:boolean}=>
      Boolean(r&&typeof r==='object'&&!Array.isArray(r)&&typeof (r as {name?:unknown}).name==='string'))
      .filter(r=>r.type==='Variable'&&!r.isCollection
       &&['Text','Number','Checkbox','Boolean','Date','DateTime'].includes(r.dataType)).map(r=>r.name):[]);
   if(typeof properties.source!=='string'||!/^@[A-Za-z][A-Za-z0-9_]*$/.test(properties.source))
    errors.push('Parse JSON needs a Text resource as source');
   if(!Array.isArray(mappings)||mappings.length<1||mappings.length>50)
    errors.push('Parse JSON requires 1 to 50 field mappings');
   else{
    const targets=new Set<string>();
    for(const item of mappings){
     if(!item||typeof item!=='object'||Array.isArray(item)){
      errors.push('Parse JSON has an invalid field mapping');continue;
     }
     const mapping=item as {path?:unknown;outputVariable?:unknown};
     if(typeof mapping.path!=='string'||mapping.path.length>256
       || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*|\[(?:0|[1-9][0-9]{0,2})\])*$/.test(mapping.path))
      errors.push('Parse JSON mapping must select a safe field path');
     if(typeof mapping.outputVariable!=='string'||!vars.has(mapping.outputVariable))
      errors.push('Parse JSON output must be a declared writable scalar Flow variable');
     else if(targets.has(mapping.outputVariable))
      errors.push('Parse JSON cannot assign the same Flow variable twice');
     else targets.add(mapping.outputVariable);
    }
   }
  }
  if(type==='Screen'&&Array.isArray(properties.fields)){
    try{
      const choices=Array.isArray(data.resources)?data.resources.filter(item=>item
        &&typeof item==='object'&&!Array.isArray(item)) as Array<{
         name:string;type:string;value?:unknown
        }>:[];
      hydrateFlowScreenChoices({id:node.id as number,type:'Screen',
        label:String(node.label??'Screen'),config:properties},choices);
      const declared=Array.isArray(data.resources)
        ?data.resources.filter(item=>!!item&&typeof item==='object'&&!Array.isArray(item))
          .map(item=>item as {name:string;type:string;dataType:string}):[];
      const graphNodes=nodes.filter(item=>!!item&&typeof item==='object'&&!Array.isArray(item)) as Array<{id?:unknown;type?:unknown;config?:unknown}>;
      errors.push(...validateScreenRecordBindings({config:properties},declared,graphNodes));
    }catch(error){errors.push(error instanceof Error?error.message:'Invalid Screen Choice Set');}
  }
  if(type==='Assignment'){
   const variable=String(properties.variable??'');
   const target=/^\$Record\.([A-Za-z][A-Za-z0-9_]*)$/.exec(variable);
   if(variable.startsWith('$Record.')&&(!beforeSave||!target))
    errors.push('Assignments to $Record fields require a valid before-save Record-Triggered Flow target');
   if(target&&properties.operator!==undefined&&properties.operator!=='Assign')
    errors.push('Before-save $Record assignments support only the Assign operator');
  }
  if(type==='Custom Error'){
   if(!['Record-Triggered Flow','Autolaunched Flow'].includes(String(data.flowType)))
    errors.push('Custom Error is supported only in Record-Triggered and Autolaunched Flows');
   if(typeof properties.errorMessage!=='string'||!properties.errorMessage.trim()
     ||properties.errorMessage.length>1000)
    errors.push('Custom Error requires a message of at most 1000 characters');
   if(!['Page','Field'].includes(String(properties.errorLocation??'Page')))
    errors.push('Custom Error location must be Page or Field');
   if(properties.errorLocation==='Field'){
    const field=properties.fieldName;
    if(typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
     errors.push('Field-level Custom Error requires a valid field');
    else if(startConfig.trigger==='deleted')
     errors.push('Field-level Custom Error cannot be used for delete triggers');
    else if(!db)
     errors.push('Field-level Custom Error requires metadata validation');
    else{
     const {rows}=await db.query(`
      SELECT 1 FROM md_field_definitions
      WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
      [tenantId,startConfig.object,field]);
     if(!rows.length)errors.push('Field-level Custom Error references an unavailable field');
    }
   }
  }
  if(type==='Start'&&data.flowType==='Record-Triggered Flow'){
   if(typeof properties.object!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.object))
    errors.push('Record-Triggered Flow Start requires a valid Object');
   if(!['created','updated','created-or-updated','deleted'].includes(String(properties.trigger??'created-or-updated')))
    errors.push('Record-Triggered Flow trigger is invalid');
   if(properties.runWhen!=='after-save')
    if(properties.runWhen!=='before-save')
     errors.push('Record-Triggered Flow save phase is invalid');
   if(properties.runWhen==='before-save'&&properties.trigger==='deleted')
    errors.push('Before-save Record-Triggered Flows cannot run on record deletion');
   if(properties.updatedRecordBehavior!==undefined
     &&!['every-time','transition'].includes(String(properties.updatedRecordBehavior)))
    errors.push('Record-Triggered Flow update behavior is invalid');
   if(properties.entryConditions!==undefined
     &&(!Array.isArray(properties.entryConditions)||properties.entryConditions.length>50))
    errors.push('Record-Triggered Flow supports up to 50 entry conditions');
   if(properties.triggerOrder!==undefined
     &&(!Number.isSafeInteger(Number(properties.triggerOrder))
       ||Number(properties.triggerOrder)<1||Number(properties.triggerOrder)>2000))
    errors.push('Record-Triggered Flow order must be between 1 and 2000');
   try{
    const dependencies=validateTriggerDependencies(properties.runAfterFlows,apiName);
    if(dependencies.length){
     if(!db)errors.push('Run-after Flows require SQL metadata validation');
     else{
      const active=await db.query<{api_name:string;id:string}>(`
       SELECT f.api_name,f.id FROM md_flow_definitions f
       JOIN md_flow_trigger_subscriptions s ON s.tenant_id=f.tenant_id AND s.flow_id=f.id
       WHERE f.tenant_id=$1 AND f.api_name=ANY($2::text[]) AND f.active=true
        AND f.archived=false AND f.flow_type='Record-Triggered Flow'
        AND s.flow_type=f.flow_type AND s.active=true`,[tenantId,dependencies]);
      if(active.rows.length!==dependencies.length)
       errors.push('Run-after Flow must be active and available in this tenant');
      const candidates=[{apiName,order:Number(properties.triggerOrder??1000),
       runAfterFlows:dependencies}];
      for(const dependency of active.rows){
       const {rows:metadata}=await db.query<MetadataValueRow>(`
        SELECT property_path,value_kind,value_text FROM md_flow_editor_values
        WHERE tenant_id=$1 AND flow_id=$2`,[tenantId,dependency.id]);
       const graph=decodeMetadataValues(metadata).builder as {
        elements?:Array<{type:string;config?:Record<string,unknown>}>}|undefined;
       const upstream=graph?.elements?.find(item=>item.type==='Start')?.config;
       if(!upstream||upstream.object!==properties.object
         ||(upstream.runWhen??'after-save')!==(properties.runWhen??'after-save'))
        errors.push('Run-after Flow must use the same Object and save phase: '+dependency.api_name);
       else candidates.push({apiName:dependency.api_name,
        order:Number(upstream.triggerOrder??1000),
        runAfterFlows:validateTriggerDependencies(upstream.runAfterFlows,dependency.api_name)});
      }
      try{orderTriggeredFlows(candidates);}
      catch(error){errors.push(error instanceof Error?error.message:'Invalid Flow dependency ordering');}
     }
    }
   }catch(error){errors.push(error instanceof Error?error.message:'Invalid Flow dependencies');}
   validConditionList(properties.entryConditions,true,'Record-Triggered Flow entry conditions',
    /^[A-Za-z][A-Za-z0-9_]*$/);
  }
  if(type==='Start'&&data.flowType==='Schedule-Triggered Flow'){
   if(typeof properties.object!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.object))
   errors.push('Schedule-Triggered Flow Start requires a valid Object');
   if(typeof properties.startDate!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(properties.startDate))
   errors.push('Schedule-Triggered Flow requires a start date');
   if(typeof properties.startTime!=='string'||! /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(properties.startTime))
   errors.push('Schedule-Triggered Flow requires a valid local start time');
   if(typeof properties.timeZone!=='string'||properties.timeZone.length>100)
   errors.push('Schedule-Triggered Flow requires an IANA time zone');
   else try{new Intl.DateTimeFormat('en-US',{timeZone:properties.timeZone});}
   catch{errors.push('Schedule-Triggered Flow time zone is invalid');}
   if(typeof properties.startDate==='string'&&typeof properties.startTime==='string'
     &&typeof properties.timeZone==='string'){
    try{resolveFlowLocalDateTime(properties.startDate,properties.startTime,properties.timeZone);}
    catch{errors.push('Schedule-Triggered Flow local start date and time are invalid');}
   }
   if(!['Once','Daily','Weekly','Monthly'].includes(String(properties.frequency)))
   errors.push('Schedule-Triggered Flow frequency must be Once, Daily, Weekly or Monthly');
   validConditionList(properties.entryConditions,false,'Schedule-Triggered Flow entry conditions',
   /^[A-Za-z][A-Za-z0-9_]*$/);
  }
  if(type==='Start'&&data.flowType==='Platform Event-Triggered Flow'){
   if(typeof properties.object!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.object))
    errors.push('Platform Event-Triggered Flow Start requires a valid event');
   validConditionList(properties.entryConditions,false,'Platform Event entry conditions',
    /^[A-Za-z][A-Za-z0-9_]*$/);
   if(typeof properties.object==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.object)){
    await rbac.require(tenantId,userId,'SystemDefinition:platform-events','read');
    if(db){
     const {rows:events}=await db.query<{api_name:string;field_api:string|null}>(`
      SELECT event.api_name,field.field_api FROM md_system_definitions AS event
      LEFT JOIN md_platform_event_fields AS field
       ON field.tenant_id=event.tenant_id AND field.event_api_name=event.api_name
      WHERE event.tenant_id=$1 AND event.kind='platform-events'
       AND event.api_name=$2 AND event.enabled=true
      ORDER BY field.sort_order,field.field_api`,
      [tenantId,properties.object]);
     const fieldNames=new Set(events.map(event=>event.field_api)
      .filter((name):name is string=>typeof name==='string'));
     if(!events.length)errors.push('Platform Event-Triggered Flow references an unavailable event');
     for(const condition of Array.isArray(properties.entryConditions)?properties.entryConditions:[]){
      const field=condition&&typeof condition==='object'&&!Array.isArray(condition)
       ?String((condition as Record<string,unknown>).field??''):'';
      if(field&&!fieldNames.has(field))errors.push('Platform Event entry condition references an unknown field');
     }
    }
   }
  }
  if(['Get Records','Update Records','Delete Records','Create Records','CreateRecord'].includes(type)
    &&(typeof properties.object!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.object)))
   errors.push(type+' requires a valid Object API name');
  if(['Update Records','Delete Records'].includes(type)){
   if(typeof properties.object!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.object))
    errors.push(type+' requires a valid Object API name');
   const source=String(properties.recordSource??(properties.recordId?'id':'filter'));
   if(!['id','record','collection','filter'].includes(source))
    errors.push(type+' record source is invalid');
   if(source==='id'&&(typeof properties.recordId!=='string'||!properties.recordId.trim()))
    errors.push(type+' requires a record ID or Flow resource reference');
   if(source==='record'&&(typeof properties.recordVariable!=='string'
      ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.recordVariable)))
    errors.push(type+' requires a valid record variable');
   if(source==='collection'&&(typeof properties.collection!=='string'
      ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.collection)))
    errors.push(type+' requires a valid record collection');
   if(source==='filter'&&(!Array.isArray(properties.conditions)||properties.conditions.length===0
      ||properties.conditions.length>50))
    errors.push(type+' filter requires between 1 and 50 conditions');
   if(source==='filter'&&Array.isArray(properties.conditions))
    for(const condition of properties.conditions){
     const field=condition&&typeof condition==='object'&&!Array.isArray(condition)
      ?String((condition as Record<string,unknown>).field??''):'';
     if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
      errors.push(type+' filter conditions require valid field API names');
    }
   if(type==='Update Records'){
    const fromRecord=properties.fieldSource==='record';
    if(properties.fieldSource!==undefined&&!fromRecord)
     errors.push('Update Records field source is invalid');
    if(fromRecord&&!['record','collection'].includes(source))
     errors.push('Record-sourced Update Records needs a record or collection target');
    if(!fromRecord&&(!Array.isArray(properties.fieldValues)||!properties.fieldValues.length))
     errors.push('Update Records requires field assignments');
    else if(!fromRecord&&Array.isArray(properties.fieldValues))for(const entry of properties.fieldValues){
     const field=entry&&typeof entry==='object'&&!Array.isArray(entry)
      ?String((entry as Record<string,unknown>).field??(entry as Record<string,unknown>).apiName??''):'';
     if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
      errors.push('Update Records field assignment must use a valid API name');
    }
   }
   if(type==='Create Records'||type==='CreateRecord'){
    if(properties.recordSource==='collection'){
     if(typeof properties.collection!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.collection))
      errors.push('Create Records requires a valid input collection');
     if(properties.resultVariable!==undefined
       &&(typeof properties.resultVariable!=='string'
         ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.resultVariable)))
      errors.push('Create Records output collection must use a valid resource name');
    }else if(properties.recordSource!==undefined&&properties.recordSource!=='fields')
     errors.push('Create Records record source is invalid');
    else if(!Array.isArray(properties.fieldValues)||!properties.fieldValues.length)
     errors.push('Create Records requires field assignments');
    else for(const entry of properties.fieldValues){
     const field=entry&&typeof entry==='object'&&!Array.isArray(entry)
      ?String((entry as Record<string,unknown>).field??(entry as Record<string,unknown>).apiName??''):'';
     if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
      errors.push('Create Records field assignment must use a valid API name');
    }
   }
  }
  if(type==='Get Available Slots'){
   const mode=String(properties.mode??'list');
   const validName=(value:unknown)=>typeof value==='string'
     &&/^[A-Za-z][A-Za-z0-9_]*$/.test(value);
   if(!['list','validate'].includes(mode))
    errors.push('Get Available Slots mode must be list or validate');
   if(!validName(properties.appointmentObject)||!validName(properties.scheduleObject))
    errors.push('Get Available Slots requires Appointment and Staff Schedule objects');
   if(typeof properties.date!=='string'||!properties.date.trim()
     ||typeof properties.staffId!=='string'||!properties.staffId.trim())
    errors.push('Get Available Slots needs a date and assigned staff reference');
   const length=Number(properties.durationMinutes??30);
   if(!Number.isSafeInteger(length)||length<5||length>240)
    errors.push('Get Available Slots duration must be 5 to 240 minutes');
   for(const key of mode==='list'
    ?['outputVariable','allowedVariable','availableVariable']
    :['selectedTime','allowedSlots','startVariable','endVariable','validVariable']){
    if(typeof properties[key]!=='string'||!String(properties[key]).trim())
     errors.push('Get Available Slots requires '+key);
   }
   if(!properties.overlapGuard||!properties.availabilityGuard)
    errors.push('Get Available Slots requires shared overlap and availability guards');
   for(const field of ['startField','endField','staffField','statusField']){
    if(properties[field]!==undefined&&!validName(properties[field]))
     errors.push('Get Available Slots has an invalid '+field+' metadata reference');
   }
   if(properties.bookingStatus!==undefined&&
     (typeof properties.bookingStatus!=='string'||!properties.bookingStatus.trim()
      ||properties.bookingStatus.length>60))
    errors.push('Get Available Slots booking status must be a short text value');
  }
  if(type==='Get Records'){
   if(properties.recordLimit!==undefined&&properties.recordLimit!=='all'
     &&(!Number.isSafeInteger(Number(properties.recordLimit))
       ||Number(properties.recordLimit)<1||Number(properties.recordLimit)>200))
    errors.push('Get Records limit must be between 1 and 200');
   if(properties.conditions!==undefined
     &&(!Array.isArray(properties.conditions)||properties.conditions.length>50))
    errors.push('Get Records supports up to 50 filter conditions');
   if(Array.isArray(properties.conditions))for(const condition of properties.conditions){
    const field=condition&&typeof condition==='object'&&!Array.isArray(condition)
     ?String((condition as Record<string,unknown>).field??''):'';
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
     errors.push('Get Records conditions require valid field API names');
   }
   if(properties.fields!==undefined&&properties.fields!=='all'
     &&(!Array.isArray(properties.fields)||properties.fields.some(field=>
       typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))))
    errors.push('Get Records fields must be "all" or valid field API names');
   if(properties.outputVariable!==undefined&&properties.outputVariable!==''
     &&(typeof properties.outputVariable!=='string'
       ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.outputVariable)))
    errors.push('Get Records output must use a valid resource name');
   if(properties.sortField!==undefined&&properties.sortField!==''
     &&(typeof properties.sortField!=='string'
       ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.sortField)))
    errors.push('Get Records sort field must be a valid field API name');
   if(properties.sortOrder!==undefined&&!['Ascending','Descending','asc','desc'].includes(String(properties.sortOrder)))
    errors.push('Get Records sort order is invalid');
  }
  if(type==='Loop'){
   if(typeof properties.collection!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.collection))
    errors.push('Loop requires a valid record collection');
   if(typeof properties.loopVariable!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.loopVariable))
    errors.push('Loop requires a valid loop variable');
   if(properties.direction!==undefined&&!['First to last','Last to first'].includes(String(properties.direction)))
    errors.push('Loop direction is invalid');
  }
  if(['Collection Filter','Collection Sort','Transform'].includes(type)){
   for(const key of ['collection','outputCollection'])
    if(typeof properties[key]!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties[key]))
     errors.push(type+' requires a valid '+(key==='collection'?'input':'output')+' collection');
   if(type==='Collection Filter'){
    if(!Array.isArray(properties.conditions)||properties.conditions.length<1||properties.conditions.length>50)
     errors.push('Collection Filter requires between 1 and 50 conditions');
    if(Array.isArray(properties.conditions))for(const condition of properties.conditions){
     const field=condition&&typeof condition==='object'&&!Array.isArray(condition)
      ?String((condition as Record<string,unknown>).field??''):'';
     if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
      errors.push('Collection Filter conditions require valid field API names');
    }
   }else if(type==='Collection Sort'){
    if(typeof properties.sortField!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.sortField))
     errors.push('Collection Sort requires a valid sort field');
    if(properties.sortOrder!==undefined&&!['Ascending','Descending'].includes(String(properties.sortOrder)))
     errors.push('Collection Sort direction is invalid');
   }else if(!Array.isArray(properties.mappings)||properties.mappings.length<1||properties.mappings.length>100)
    errors.push('Transform requires between 1 and 100 field mappings');
   else for(const mapping of properties.mappings){
    const source=mapping&&typeof mapping==='object'&&!Array.isArray(mapping)
     ?String((mapping as Record<string,unknown>).sourceField??''):'';
    const target=mapping&&typeof mapping==='object'&&!Array.isArray(mapping)
     ?String((mapping as Record<string,unknown>).targetField??''):'';
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(source)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(target))
     errors.push('Transform mappings require valid source and target field API names');
   }
  }
  if(type==='HTTP Callout'){
   if(properties.integrationConnectionId){
    if(!db)errors.push('Integration Flow Callout requires SQL metadata');
    else try{await resolveFlowIntegrationCallout(db,rbac,tenantId,userId,properties);}
    catch(error){errors.push(error instanceof Error?error.message:'Invalid provider callout');}
   }else if(typeof properties.namedCredentialId!=='string'
     ||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(properties.namedCredentialId))
    errors.push('HTTP Callout requires a tenant HTTPS Named Credential');
   if(properties.integrationConnectionResource||properties.namedCredentialResource)
    errors.push('Runtime credential resource overrides are not permitted');
   if(!['GET','POST','PUT','PATCH','DELETE'].includes(String(properties.method??'GET')))
    errors.push('HTTP Callout method is not supported');
   if(typeof properties.path!=='string'||properties.path.startsWith('/')
     ||properties.path.includes('\\')||properties.path.length>2048)
    errors.push('HTTP Callout needs a safe relative path');
   if(properties.deliveryMode==='DURABLE_ASYNC'&&(properties.statusVariable
     ||properties.responseVariable||properties.responseMapping))
    errors.push('Durable async HTTP Callout cannot return response variables');
   if(properties.deliveryMode!==undefined
     &&!['SYNC','DURABLE_ASYNC'].includes(String(properties.deliveryMode)))
    errors.push('HTTP Callout delivery mode is invalid');
   for(const property of ['queryParameters','responseMapping']){
    if(typeof properties[property]==='string'&&properties[property]){
     try{parseFlowHttpMapping(properties[property],{});}
     catch(error){
      // Syntax and field-path shape are validated here; resources bind at execution.
      if(!String(error).includes('Unknown HTTP Callout resource'))
       errors.push('Invalid HTTP Callout '+property+' mapping');
     }
    }
   }
   if(!['FAULT_PATH','FAIL','CONTINUE'].includes(String(properties.onError??'FAIL')))
    errors.push('HTTP Callout error policy is invalid');
  }
  if(type==='Action'){
   if(data.flowType==='Record-Triggered Flow'&&beforeSave)
    errors.push('Before-save Record-Triggered Flows cannot execute Actions');
   if(properties.actionType==='Generate 4-Digit Random OTP'||properties.actionType==='Generate 6-Digit Random OTP'){
    if(typeof properties.outputVariable!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(properties.outputVariable))
     errors.push('Generate Random OTP requires a valid output variable name');
    if(Array.isArray(data.resources)&&typeof properties.outputVariable==='string'
      &&!data.resources.some((resource:unknown)=>!!resource&&typeof resource==='object'
       &&(resource as Record<string,unknown>).name===properties.outputVariable))
     errors.push('Generate Random OTP output must be declared as a Flow resource');
   }else if(properties.actionType==='Create Task'){
    if(typeof properties.objectApiName!=='string'
      ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.objectApiName))
     errors.push('Create Task requires a valid target Object');
    if(typeof properties.recordId!=='string'||!properties.recordId.trim()
      ||properties.recordId.length>512)
     errors.push('Create Task requires a target record ID or resource');
    if(typeof properties.subject!=='string'||!properties.subject.trim()
      ||properties.subject.length>200)
     errors.push('Create Task requires a subject of at most 200 characters');
    if(properties.description!==undefined
      &&(typeof properties.description!=='string'||properties.description.length>10000))
     errors.push('Create Task description must be at most 10000 characters');
    if(properties.dueAt!==undefined
      &&(typeof properties.dueAt!=='string'||properties.dueAt.length>128))
     errors.push('Create Task due date must be text or a resource reference');
   }else if(properties.actionType==='Outbound Message'){
    if(properties.deliveryMode!==undefined&&properties.deliveryMode!=='DURABLE_ASYNC')
     errors.push('Outbound Message requires durable SQL delivery');
    if(properties.integrationConnectionId){
     if(!db)errors.push('Outbound Message requires SQL integration metadata');
     else try{
      const resolved=await resolveFlowIntegrationCallout(db,rbac,tenantId,userId,properties);
      if(resolved.method!=='POST')errors.push('Outbound Message requires a POST provider operation');
     }catch(error){errors.push(error instanceof Error?error.message:'Invalid Outbound Message provider');}
    }else if(typeof properties.namedCredentialId!=='string'
      ||!/^[0-9a-f-]{36}$/i.test(properties.namedCredentialId))
     errors.push('Outbound Message requires an HTTPS Named Credential or active integration');
    if(typeof properties.body!=='string'||!properties.body.trim()
       ||properties.body.length>32768)
     errors.push('Outbound Message requires a structured request body');
    else try{JSON.parse(properties.body);}
    catch{errors.push('Outbound Message request body must be a structured mapping');}
    if(properties.integrationConnectionResource||properties.namedCredentialResource)
     errors.push('Outbound Message does not allow dynamic credential overrides');
   }else if(properties.actionType==='Send Email'||properties.actionType==='Email Alert'){
    errors.push('SMTP-based email actions are disabled; configure email delivery with an HTTPS Named Credential and HTTP Callout Flow');
   }else if(properties.actionType==='Post to Chatter'){
    if(typeof properties.objectApiName!=='string'
      ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.objectApiName))
     errors.push('Post to Chatter requires a valid target Object');
    if(typeof properties.recordId!=='string'||!properties.recordId.trim()
      ||properties.recordId.length>512)
     errors.push('Post to Chatter requires a target record ID or resource');
    if(typeof properties.message!=='string'||!properties.message.trim()
      ||properties.message.length>10000)
     errors.push('Post to Chatter requires a message of at most 10000 characters');
    }else if(properties.actionType==='Quick Actions'){
     const objectApiName=properties.objectApiName,actionId=properties.quickActionId;
     if(typeof objectApiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApiName))
      errors.push('Quick Actions requires a valid target Object');
     if(typeof actionId!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(actionId))
      errors.push('Quick Actions requires a configured object action');
     if(typeof properties.recordId!=='string'||!properties.recordId.trim()
       ||properties.recordId.length>512)
      errors.push('Quick Actions requires a target record ID or resource');
     if(db&&typeof objectApiName==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApiName)
       &&typeof actionId==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(actionId)){
      await rbac.require(tenantId,userId,'ObjectDefinition','read');
      await rbac.require(tenantId,userId,objectApiName,'read');
      const {rows}=await db.query(`
       SELECT 1 FROM md_object_actions
       WHERE tenant_id=$1 AND object_api=$2 AND action_id=$3 AND action_type='Custom'
        AND enabled=true AND behavior='Set Field Value'`,
       [tenantId,objectApiName,actionId]);
      if(!rows.length)errors.push('Quick Action is unavailable or unsupported');
     }
    }else if(properties.actionType==='Submit for Approval'){
     if(typeof properties.objectApiName!=='string'
       ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.objectApiName))
      errors.push('Submit for Approval requires a valid target Object');
     if(typeof properties.recordId!=='string'||!properties.recordId.trim()
       ||properties.recordId.length>512)
      errors.push('Submit for Approval requires a target record ID or resource');
     if(properties.approvalProcessApiName!==undefined
       &&(typeof properties.approvalProcessApiName!=='string'
        ||! /^[A-Za-z][A-Za-z0-9_]*$/.test(properties.approvalProcessApiName)))
      errors.push('Approval Process API name is invalid');
     if(!(typeof properties.approvalProcessApiName==='string'
       &&properties.approvalProcessApiName.trim())
       &&(typeof properties.approverIds!=='string'||!properties.approverIds.trim()
        ||properties.approverIds.length>4096))
      errors.push('Submit for Approval requires an active process or approver IDs');
     if(properties.comments!==undefined
       &&(typeof properties.comments!=='string'||properties.comments.length>2000))
      errors.push('Approval comments must be at most 2000 characters');
    }else if(properties.actionType==='Custom Notification'){
    if(typeof properties.recipientIds!=='string'||!properties.recipientIds.trim()
      ||properties.recipientIds.length>4096)
     errors.push('Custom Notification requires recipient user IDs');
    if(typeof properties.title!=='string'||!properties.title.trim()||properties.title.length>120)
     errors.push('Custom Notification requires a title of at most 120 characters');
    if(properties.messageBody!==undefined
      &&(typeof properties.messageBody!=='string'||properties.messageBody.length>2000))
     errors.push('Custom Notification message must be at most 2000 characters');
   }else if(properties.actionType==='External Service Action'){
    const serviceApi=properties.externalServiceApiName;
    const operationApi=properties.externalOperationApiName;
    const credentialId=properties.namedCredentialId;
    const inputs=properties.externalInputs;
    if(typeof serviceApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(serviceApi)
      ||typeof operationApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(operationApi))
     errors.push('External Service Action requires a saved service and operation');
    if(typeof credentialId!=='string'||!/^[0-9a-f-]{36}$/i.test(credentialId))
     errors.push('External Service Action requires an HTTPS Named Credential');
    if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))
     errors.push('External Service Action input mappings are invalid');
    if(db&&typeof serviceApi==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(serviceApi)
      &&typeof operationApi==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(operationApi)){
     await rbac.require(tenantId,userId,'NamedCredential','read');
     await rbac.require(tenantId,userId,'HTTPCallout','execute');
     const {rows:operations}=await db.query<{operation_api:string;server_origin:string}>(`
      SELECT o.operation_api,s.server_origin FROM md_external_service_operations o
      JOIN md_external_services s ON s.tenant_id=o.tenant_id AND s.api_name=o.service_api
      WHERE o.tenant_id=$1 AND o.service_api=$2 AND o.operation_api=$3`,
      [tenantId,serviceApi,operationApi]);
     if(!operations.length)errors.push('External Service operation is unavailable');
     const {rows:required}=await db.query<{parameter_name:string;parameter_location:string}>(`
      SELECT parameter_name,parameter_location FROM md_external_service_parameters
      WHERE tenant_id=$1 AND service_api=$2 AND operation_api=$3 AND required=true`,
      [tenantId,serviceApi,operationApi]);
     if(inputs&&typeof inputs==='object'&&!Array.isArray(inputs)){
      const mapped=inputs as Record<string,unknown>;
      for(const parameter of required)if(typeof mapped[parameter.parameter_name]!=='string'
        ||!String(mapped[parameter.parameter_name]).trim())
       errors.push('External Service input is required: '+parameter.parameter_name);
      const {rows:parameters}=await db.query<{parameter_name:string}>(`
       SELECT parameter_name FROM md_external_service_parameters
       WHERE tenant_id=$1 AND service_api=$2 AND operation_api=$3`,
       [tenantId,serviceApi,operationApi]);
      const allowed=new Set(parameters.map(parameter=>parameter.parameter_name));
      for(const [name,value] of Object.entries(mapped))
       if(!allowed.has(name)||typeof value!=='string'||value.length>8192)
        errors.push('External Service input mapping is invalid: '+name);
     }
    }
    if(typeof credentialId==='string'&&/^[0-9a-f-]{36}$/i.test(credentialId)&&db){
     const {rows:credentials}=await db.query<{base_url:string}>(`
      SELECT base_url FROM md_named_credentials
      WHERE tenant_id=$1 AND id=$2 AND protocol='HTTPS' AND enabled=true`,
      [tenantId,credentialId]);
     if(!credentials.length)errors.push('External Service HTTPS credential is unavailable');
     else if(typeof serviceApi==='string'&&typeof operationApi==='string'){
      const {rows:service}=await db.query<{server_origin:string}>(`
       SELECT s.server_origin FROM md_external_service_operations o
       JOIN md_external_services s ON s.tenant_id=o.tenant_id AND s.api_name=o.service_api
       WHERE o.tenant_id=$1 AND o.service_api=$2 AND o.operation_api=$3`,
       [tenantId,serviceApi,operationApi]);
      try{
       const credentialUrl=new URL(credentials[0].base_url);
       if(!service[0]||credentialUrl.protocol!=='https:'
         ||credentialUrl.origin!==service[0].server_origin||credentialUrl.pathname!=='/'
         ||credentialUrl.search||credentialUrl.hash||credentialUrl.username||credentialUrl.password)
        errors.push('External Service HTTPS credential origin must match the imported API server');
      }catch{errors.push('External Service HTTPS credential URL is invalid');}
     }
    }
   }else
    errors.push('Unsupported Flow action: '+String(properties.actionType??''));
  }
  if(type==='Subflow'){
   if(typeof properties.flowApiName!=='string'||! /^[A-Za-z][A-Za-z0-9_]*$/.test(properties.flowApiName)
     ||properties.flowApiName===apiName)
    errors.push('Subflow requires a different Flow API name');
   for(const property of ['inputValues','outputValues']){
    const value=properties[property]??'';
    if(typeof value!=='string'||value.length>8192
      ||value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
        .some(line=>! /^[A-Za-z][A-Za-z0-9_]*\s*=\s*[^=].{0,4095}$/.test(line)))
     errors.push('Subflow '+property+' mappings are invalid');
   }
  }
  if(type==='Publish Platform Event'){
   if(data.flowType==='Record-Triggered Flow'&&beforeSave)
    errors.push('Before-save Record-Triggered Flows cannot publish Platform Events');
   if(data.flowType==='Platform Event-Triggered Flow')
    errors.push('Platform Event-Triggered Flows cannot recursively publish Platform Events');
   if(typeof properties.eventApiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.eventApiName))
    errors.push('Publish Platform Event requires an enabled event');
   if(!Array.isArray(properties.fieldValues)||properties.fieldValues.length>100)
    errors.push('Publish Platform Event supports at most 100 field mappings');
   else {
    const mappedFields=new Set<string>();
    for(const mapping of properties.fieldValues){
    const item=mapping&&typeof mapping==='object'&&!Array.isArray(mapping)
     ?mapping as Record<string,unknown>:{};
    if(typeof item.field!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(item.field)
      ||typeof item.value!=='string'||item.value.length>4096)
     errors.push('Publish Platform Event field mappings require valid fields and values');
    else if(mappedFields.has(item.field))errors.push('Publish Platform Event fields may be mapped only once');
    else mappedFields.add(item.field);
    }
   }
   if(typeof properties.eventApiName==='string'&&db
     &&/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.eventApiName)){
    await rbac.require(tenantId,userId,'SystemDefinition:platform-events','read');
    const {rows:events}=await db.query<{api_name:string;field_api:string|null}>(`
     SELECT d.api_name,f.field_api FROM md_system_definitions d
     LEFT JOIN md_platform_event_fields f
      ON f.tenant_id=d.tenant_id AND f.event_api_name=d.api_name
     WHERE d.tenant_id=$1 AND d.kind='platform-events' AND d.api_name=$2 AND d.enabled=true
     ORDER BY f.sort_order,f.field_api`,
     [tenantId,properties.eventApiName]);
    const fieldNames=new Set(events.map(event=>event.field_api).filter(
     (field):field is string=>typeof field==='string'));
    if(!events.length)errors.push('Publish Platform Event references an unavailable event');
    for(const mapping of Array.isArray(properties.fieldValues)?properties.fieldValues:[]){
     const field=mapping&&typeof mapping==='object'&&!Array.isArray(mapping)
      ?String((mapping as Record<string,unknown>).field??''):'';
     if(field&&!fieldNames.has(field))errors.push('Publish Platform Event references an unknown field');
    }
   }
  }
  if(type==='Screen'){
   const fields=properties.fields;
   if(!Array.isArray(fields)||fields.length>100)errors.push('Screen must declare up to 100 fields');
   else {
    const names=new Set<string>();
    for(const field of fields){
     if(!field||typeof field!=='object'||Array.isArray(field)){errors.push('Invalid Screen field');continue;}
     const name=(field as Record<string,unknown>).apiName;
     if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)||names.has(name))
      errors.push('Screen fields require unique safe API names');
     else names.add(name);
    }
    for(const field of fields){
     if(!field||typeof field!=='object'||Array.isArray(field))continue;
     const config=field as Record<string,unknown>;
     const fieldName=String(config.apiName??'');
     if(config.visibilityLogic!==undefined
       &&!['all','any'].includes(String(config.visibilityLogic).toLowerCase()))
      errors.push('Screen visibility logic must be All or Any: '+fieldName);
     if(config.visibilityConditions===undefined)continue;
     if(!Array.isArray(config.visibilityConditions)){
      errors.push('Screen visibility conditions must be a list: '+fieldName);continue;
     }
     for(const condition of config.visibilityConditions){
      if(!condition||typeof condition!=='object'||Array.isArray(condition)){
       errors.push('Screen contains an invalid visibility condition: '+fieldName);continue;
      }
      const rule=condition as Record<string,unknown>;
      if(typeof rule.field!=='string'||!names.has(rule.field)||rule.field===fieldName)
       errors.push('Screen visibility condition must reference another screen field: '+fieldName);
      if(!screenVisibilityOperators.has(String(rule.operator??'Equals')))
       errors.push('Unsupported Screen visibility operator: '+String(rule.operator??''));
     }
    }
   }
  }
  if(type==='Decision'&&Array.isArray(properties.outcomes)){
   for(const outcome of properties.outcomes){
    if(!outcome||typeof outcome!=='object'||Array.isArray(outcome)){
     errors.push('Decision contains an invalid outcome');continue;
    }
    validConditionList((outcome as Record<string,unknown>).conditions,
     data.flowType==='Record-Triggered Flow','Decision outcome conditions',
     data.flowType==='Record-Triggered Flow'?/^\{!\$Record\.[A-Za-z][A-Za-z0-9_]*\}$/:undefined);
   }
  }
  if(type==='Orchestration Stage'){
   if(data.flowType!=='Flow Orchestration')
    errors.push('Orchestration Stage is only supported in Flow Orchestration');
   const object=properties.objectApiName,record=properties.recordId;
   if(typeof object!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(object))
    errors.push('Orchestration Stage requires an Object');
   if(typeof record!=='string'||!record.trim()||record.length>255)
    errors.push('Orchestration Stage requires a target record ID or resource');
   if(!['ANY','ALL'].includes(String(properties.approvalMode??'ANY')))
    errors.push('Orchestration Stage approval rule must be ANY or ALL');
   const process=properties.approvalProcessApiName;
   if(process&&
     (typeof process!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(process)))
    errors.push('Orchestration Stage approval process is invalid');
   if(!process&&
      (typeof properties.approverIds!=='string'||!properties.approverIds.trim()))
    errors.push('Orchestration Stage requires active approval process or approvers');
   if(properties.comments!==undefined&&
      (typeof properties.comments!=='string'||properties.comments.length>2000))
    errors.push('Orchestration Stage comments exceed 2000 characters');
   if(properties.statusVariable!==undefined&&properties.statusVariable!==''
       &&(typeof properties.statusVariable!=='string'
          ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.statusVariable)))
    errors.push('Orchestration Stage output variable must be a declared Text variable');
   if(typeof properties.statusVariable==='string'&&properties.statusVariable){
     const value=Array.isArray(data.resources)?data.resources.find(resource=>
       resource&&typeof resource==='object'&&
       (resource as Record<string,unknown>).name===properties.statusVariable
       &&(resource as Record<string,unknown>).type==='Variable'
       &&(resource as Record<string,unknown>).dataType==='Text'
       &&(resource as Record<string,unknown>).isCollection!==true):undefined;
     if(!value)errors.push('Orchestration Stage requires an existing Text output variable');
   }
  }
  if(type==='Wait'){
   try{resolveFlowWaitUntil(properties);}
   catch(error){errors.push(error instanceof Error?error.message:'Wait configuration is invalid');}
  }
 }
 const resources=Array.isArray(data.resources)
  ?data.resources.filter((item):item is Record<string,unknown> =>
   Boolean(item)&&typeof item==='object'&&!Array.isArray(item)):[];
 const resourcesByName=new Map(resources.filter(item=>typeof item.name==='string')
  .map(item=>[String(item.name),item]));
 const objectApis=new Set<string>(),fieldApis=new Map<string,Set<string>>();
 const requireRecordResource=(name:unknown,collection:boolean,objectApi:string,elementType:string)=>{
  if(typeof name!=='string')return;
  const resource=resourcesByName.get(name);
  const expectedType=collection?'Record Collection':'Record';
  if(!resource||resource.type!==expectedType||resource.dataType!==objectApi)
   errors.push(elementType+' requires a '+expectedType+' resource for '+objectApi+': '+name);
 };
 const loopVariableObjects=new Map<string,string>();
 const loopVariableNames=new Set<string>();
 for(const item of nodes){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  const node=item as Record<string,unknown>;
  if(node.type!=='Loop'||!node.config||typeof node.config!=='object'||Array.isArray(node.config))continue;
  const config=node.config as Record<string,unknown>;
  const source=resourcesByName.get(String(config.collection??''));
  if(typeof config.loopVariable==='string'){
   if(resourcesByName.has(config.loopVariable))
    errors.push('Loop variable must not conflict with a declared Flow resource: '+config.loopVariable);
   if(loopVariableNames.has(config.loopVariable))
    errors.push('Loop variable names must be unique within a Flow: '+config.loopVariable);
   loopVariableNames.add(config.loopVariable);
   if(source?.type!=='Record Collection')
    errors.push('Loop requires a declared Record Collection: '+String(config.collection??''));
   else if(typeof source.dataType==='string')loopVariableObjects.set(config.loopVariable,source.dataType);
  }
 }
 const addFields=(objectApi:string,value:unknown)=>{
  if(!Array.isArray(value))return;
  const known=fieldApis.get(objectApi)??new Set<string>();
  for(const field of value)if(typeof field==='string'&&field.trim())known.add(field.trim());
  fieldApis.set(objectApi,known);
 };
 const addConditions=(objectApi:string,value:unknown)=>{
  if(!Array.isArray(value))return;
  addFields(objectApi,value.map(condition=>condition&&typeof condition==='object'
   &&!Array.isArray(condition)?(condition as Record<string,unknown>).field:undefined));
 };
 if(['Record-Triggered Flow','Schedule-Triggered Flow'].includes(String(data.flowType))
   &&typeof startConfig.object==='string'
   &&/^[A-Za-z][A-Za-z0-9_]*$/.test(startConfig.object)){
  objectApis.add(startConfig.object);
  addConditions(startConfig.object,startConfig.entryConditions);
 }
 for(const resource of resources){
  if(resource.type==='Record'||resource.type==='Record Collection'){
   if(typeof resource.dataType!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(resource.dataType))
    errors.push('Flow record resources require a valid Object API name: '+String(resource.name??''));
   else objectApis.add(resource.dataType);
  }
 }
 for(const item of nodes){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  const node=item as Record<string,unknown>;
  const config=node.config&&typeof node.config==='object'&&!Array.isArray(node.config)
   ?node.config as Record<string,unknown>:{};
  const type=String(node.type??''),objectApi=String(config.object??'');
  if(type==='Assignment'&&typeof config.variable==='string'
    &&!/^\$Record\./.test(config.variable)){
   const target=resourcesByName.get(config.variable);
   if(target?.type==='Record Collection'){
    const operator=String(config.operator??'Assign');
    if(!['Assign','Add','Add At Beginning','Add At End','Remove','Remove All'].includes(operator))
     errors.push('Unsupported record collection assignment operator: '+operator);
    if(operator!=='Remove All'){
     const reference=typeof config.value==='string'
      ?(()=>{const match=/^(?:\{!([A-Za-z][A-Za-z0-9_]*)\}|@([A-Za-z][A-Za-z0-9_]*))$/
        .exec(config.value.trim());return match?.[1]??match?.[2];})():undefined;
     if(!reference)errors.push('Record collection assignments require a record resource reference');
     else{
      const source=resourcesByName.get(reference);
      const expectedCollection=operator==='Assign';
      const compatible=expectedCollection
       ?source?.type==='Record Collection'&&source.dataType===target.dataType
       :source?.type==='Record'&&source.dataType===target.dataType
        ||loopVariableObjects.get(reference)===target.dataType;
      if(!compatible)errors.push('Record collection assignment source must match its target Object');
     }
    }
   }else if(target&&target.type!=='Variable')
    errors.push('Flow Assignment target must be a Variable or Record Collection: '+config.variable);
   else if(target?.type==='Variable'){
    const operator=String(config.operator??'Assign');
    const numeric=['Number','Currency','Percent'].includes(String(target.dataType));
    const text=['Text','Picklist','Id'].includes(String(target.dataType));
    if(operator!=='Assign'
      &&!((numeric&&['Add','Subtract','Multiply','Divide'].includes(operator))
       ||(text&&['Add At Beginning','Add At End'].includes(operator))))
     errors.push('Flow Assignment operator is incompatible with variable type: '+operator);
   }
  }
  if(['Get Records','Create Records','CreateRecord','Update Records','Delete Records'].includes(type)
    &&/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi))objectApis.add(objectApi);
  if(type==='Get Records'){
   const limit=config.recordLimit==='all'?200:Number(config.recordLimit??1);
   const output=typeof config.outputVariable==='string'?config.outputVariable:'';
   if(!output)errors.push('Get Records requires an output resource');
   else requireRecordResource(output,limit>1,objectApi,type);
   addConditions(objectApi,config.conditions);
   if(Array.isArray(config.fields))addFields(objectApi,config.fields.filter(field=>
    !['Id','CreatedAt','LastModifiedDate','OwnerId','RecordTypeId'].includes(String(field))));
   addFields(objectApi,[config.sortField]);
  }else if(type==='Create Records'||type==='CreateRecord'){
   if(config.recordSource==='collection'){
    requireRecordResource(config.collection,true,objectApi,type);
    if(config.resultVariable!==undefined&&config.resultVariable!=='')
     requireRecordResource(config.resultVariable,true,objectApi,type+' output');
   }else if(Array.isArray(config.fieldValues)){
    addFields(objectApi,config.fieldValues.map(value=>value&&typeof value==='object'
     &&!Array.isArray(value)?(value as Record<string,unknown>).field:undefined));
   }
  }else if(type==='Update Records'||type==='Delete Records'){
   const source=String(config.recordSource??(config.recordId?'id':'filter'));
   if(source==='record')requireRecordResource(config.recordVariable,false,objectApi,type);
   if(source==='collection')requireRecordResource(config.collection,true,objectApi,type);
   if(source==='filter')addConditions(objectApi,config.conditions);
   if(type==='Update Records'&&Array.isArray(config.fieldValues))
    addFields(objectApi,config.fieldValues.map(value=>value&&typeof value==='object'
     &&!Array.isArray(value)?(value as Record<string,unknown>).field:undefined));
  }else if(type==='Collection Filter'||type==='Collection Sort'||type==='Transform'){
   const sourceName=String(config.collection??''),source=resourcesByName.get(sourceName);
   const target=resourcesByName.get(String(config.outputCollection??''));
   const sourceObject=typeof source?.dataType==='string'?source.dataType:'';
   if(type==='Transform'){
    if(source?.type!=='Record Collection')
     errors.push('Transform requires a Record Collection input: '+sourceName);
    if(target?.type!=='Record Collection')
     errors.push('Transform requires a Record Collection output: '+String(config.outputCollection??''));
    if(Array.isArray(config.mappings))for(const mapping of config.mappings){
     if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))continue;
     const row=mapping as Record<string,unknown>;
     addFields(sourceObject,[row.sourceField]);
     if(typeof target?.dataType==='string')addFields(target.dataType,[row.targetField]);
    }
   }else{
    requireRecordResource(sourceName,true,sourceObject,type);
    requireRecordResource(config.outputCollection,true,sourceObject,type+' output');
    if(type==='Collection Filter')addConditions(sourceObject,config.conditions);
    else addFields(sourceObject,[config.sortField]);
   }
  }
 }
 if(db&&objectApis.size){
  const names=[...objectApis];
  const requiredFields=[...new Set([...fieldApis.values()].flatMap(fields=>[...fields]))];
  const [objectsResult,fieldsResult]=await Promise.all([
   db.query<{api_name:string}>(
    'SELECT api_name FROM md_object_definitions WHERE tenant_id=$1 AND api_name=ANY($2::text[])',
    [tenantId,names]),
   db.query<{object_api:string;api_name:string}>(
    `SELECT object_api,api_name FROM md_field_definitions
     WHERE tenant_id=$1 AND object_api=ANY($2::text[]) AND api_name=ANY($3::text[])
      AND deleted_at IS NULL`,
    [tenantId,names,requiredFields])
  ]);
  const availableObjects=new Set(objectsResult.rows.map(row=>row.api_name));
  const availableFields=new Map<string,Set<string>>();
  for(const row of fieldsResult.rows){
   const fields=availableFields.get(row.object_api)??new Set<string>();
   fields.add(row.api_name);availableFields.set(row.object_api,fields);
  }
  for(const objectApi of names)
   if(!availableObjects.has(objectApi))
    errors.push('Flow data action references an unavailable Object: '+objectApi);
  for(const [objectApi,fields] of fieldApis)
   for(const field of fields)
    if(!['Id','OwnerId','RecordTypeId'].includes(field)&&!availableFields.get(objectApi)?.has(field))
     errors.push('Flow data action references an unavailable field: '+objectApi+'.'+field);
 }
 if([...types.values()].filter(x=>x==='Start').length!==1)errors.push('Flow must contain exactly one Start');
 if(![...types.values()].includes('End'))errors.push('Flow must contain an End');
 const outgoing=new Map<number,number[]>(),incoming=new Map<number,number[]>();
 const connectors=new Map<number,Array<{to:number;label:string;kind:string}>>();
 const faultSources=new Set<number>();
 let scheduledPathCount=0;
 for(const link of links){
  if(!link||typeof link!=='object'||Array.isArray(link)){errors.push('Invalid Flow connector');continue;}
  const edge=link as Record<string,unknown>;
  if(typeof edge.from!=='number'||typeof edge.to!=='number'||!ids.has(edge.from)||!ids.has(edge.to)){
   errors.push('Flow connector references an unknown element');continue;
  }
  if(edge.kind!==undefined&&!['normal','fault','scheduled','async'].includes(String(edge.kind)))
   errors.push('Unsupported SQL Flow connector type');
  const kind=String(edge.kind??'normal');
  if(kind==='fault'){
   const faultCapable=new Set(['Get Records','Create Records','CreateRecord','Update Records',
    'Delete Records','Collection Filter','Collection Sort','Transform','Subflow','HTTP Callout',
    'Action','Publish Platform Event']);
   if(!faultCapable.has(types.get(edge.from)??''))
    errors.push('Fault connectors are not supported from this Flow element: '+edge.from);
   if(faultSources.has(edge.from))
    errors.push('Flow elements may have at most one Fault connector: '+edge.from);
   faultSources.add(edge.from);
   if(types.get(edge.from)==='HTTP Callout'){
    const source=nodes.find(item=>item&&typeof item==='object'&&!Array.isArray(item)
     &&(item as Record<string,unknown>).id===edge.from) as Record<string,unknown>|undefined;
    const config=source?.config&&typeof source.config==='object'&&!Array.isArray(source.config)
     ?source.config as Record<string,unknown>:{};
    if(config.onError!=='FAULT_PATH')
     errors.push('HTTP Callout Fault connector requires the Fault Path error policy: '+edge.from);
   }
  }
  if(kind==='async'){
    const origin=nodes.find(item=>item&&typeof item==='object'&&!Array.isArray(item)
      &&(item as Record<string,unknown>).id===edge.from) as Record<string,unknown>|undefined;
    if(data.flowType!=='Record-Triggered Flow'||beforeSave||origin?.type!=='Start'
       ||startConfig.trigger==='deleted')
      errors.push('Asynchronous paths require an after-save Record-Triggered Flow Start');
  }
  if(kind==='scheduled'){
   scheduledPathCount++;
   const source=nodes.find(item=>item&&typeof item==='object'&&!Array.isArray(item)
    &&(item as Record<string,unknown>).id===edge.from) as Record<string,unknown>|undefined;
   const configuration=edge.scheduledPath;
   if(data.flowType!=='Record-Triggered Flow'||beforeSave||source?.type!=='Start')
    errors.push('Scheduled Paths are supported only from after-save Record-Triggered Flow Start elements');
   if(scheduledPathCount>20)errors.push('A Flow may contain at most 20 Scheduled Paths');
   if(!configuration||typeof configuration!=='object'||Array.isArray(configuration)){
    errors.push('Scheduled Path requires time source and offset configuration');
   }else{
    const path=configuration as Record<string,unknown>,field=path.timeSourceFieldApiName,
     amount=Number(path.offsetAmount),unit=String(path.offsetUnit);
    if(typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(field))
     errors.push('Scheduled Path requires a valid time source field');
    if(!Number.isSafeInteger(amount)||Math.abs(amount)>3650
      ||!['Minutes','Hours','Days'].includes(unit))
     errors.push('Scheduled Path offset must be an integer from -3650 to 3650 Minutes, Hours or Days');
    if(typeof field==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(field)){
     if(!db)errors.push('Scheduled Path field validation requires SQL metadata');
     else{
      const {rows:fieldRows}=await db.query<{data_type:string}>(`
       SELECT data_type FROM md_field_definitions
       WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
       [tenantId,startConfig.object,field]);
      if(!['date','datetime'].includes(fieldRows[0]?.data_type??''))
       errors.push('Scheduled Path time source must be a Date or DateTime field');
      else await rbac.require(tenantId,userId,
       String(startConfig.object)+'.'+field,'read');
     }
    }
   }
  }
  outgoing.set(edge.from,[...(outgoing.get(edge.from)??[]),edge.to]);
  incoming.set(edge.to,[...(incoming.get(edge.to)??[]),edge.from]);
  connectors.set(edge.from,[...(connectors.get(edge.from)??[]),{
   to:edge.to,label:String(edge.label??''),kind
  }]);
 }
 for(const item of nodes){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  const node=item as Record<string,unknown>;
  if(node.type==='HTTP Callout'&&node.config&&typeof node.config==='object'
    &&!Array.isArray(node.config)
    &&(node.config as Record<string,unknown>).onError==='FAULT_PATH'
    &&!faultSources.has(Number(node.id)))
   errors.push('HTTP Callout Fault Path error policy requires a Fault connector: '+String(node.id));
 }
 for(const id of ids)
  if(types.get(id)==='End'&&(outgoing.get(id)?.length??0)>0)
   errors.push('End must not have outgoing connectors: '+id);
 const canFinish=new Set<number>();
 const reverseStack=[...types].filter(([,type])=>type==='End').map(([id])=>id);
 while(reverseStack.length){
  const id=reverseStack.pop()!;
  if(canFinish.has(id))continue;
  canFinish.add(id);
  reverseStack.push(...(incoming.get(id)??[]));
 }
 const start=[...types].find(([,type])=>type==='Start')?.[0];
 if(start!==undefined){
  const visited=new Set<number>(),stack=[start];
  while(stack.length){
   const id=stack.pop()!;
   if(visited.has(id))continue;
   visited.add(id);
   stack.push(...(outgoing.get(id)??[]));
  }
  if(![...visited].some(id=>types.get(id)==='End'))errors.push('No reachable End element');
  for(const id of visited){
   if(!canFinish.has(id))errors.push('Flow path cannot reach End from element: '+id);
   if(types.get(id)!=='End'&&!(connectors.get(id)??[]).some(edge=>edge.kind==='normal'))
    errors.push('Flow element requires a normal outgoing path: '+id);
  }
  for(const id of ids)if(!visited.has(id))warnings.push('Disconnected Flow element: '+id);
 }
 for(const raw of nodes){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const node=raw as Record<string,unknown>;
  if(node.type!=='Orchestration Stage'||typeof node.id!=='number')continue;
  const paths=(connectors.get(node.id)??[]).filter(edge=>edge.kind==='normal');
  for(const label of ['Approved','Rejected'])
   if(paths.filter(edge=>edge.label===label).length!==1)
    errors.push('Orchestration Stage requires exactly one '+label+' connector: '+node.id);
  if(paths.some(edge=>!['Approved','Rejected'].includes(edge.label)))
   errors.push('Orchestration Stage has an invalid connector outcome: '+node.id);
 }
 for(const raw of nodes){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const node=raw as Record<string,unknown>;
  if(node.type!=='Decision'||typeof node.id!=='number')continue;
  const config=node.config as Record<string,unknown>|undefined;
  const outcomes=Array.isArray(config?.outcomes)?config.outcomes as Array<Record<string,unknown>>:[];
  const labels=outcomes.map(outcome=>outcome?.name==='Default'
    ?'Default':String(outcome?.label??outcome?.name??'')).filter(Boolean);
  if(!labels.includes('Default'))labels.push('Default');
  if(new Set(labels).size!==labels.length)errors.push('Duplicate Decision outcome labels: '+node.id);
  const paths=(connectors.get(node.id)??[]).filter(edge=>edge.kind==='normal');
  for(const label of labels)
   if(paths.filter(edge=>edge.label===label).length!==1)
    errors.push('Decision outcome needs exactly one connector: '+node.id+' / '+label);
  for(const path of paths)if(!labels.includes(path.label))
   errors.push('Decision has an unmatched outcome connector: '+node.id+' / '+path.label);
 }
 return {valid:errors.length===0,errors,warnings};
}
