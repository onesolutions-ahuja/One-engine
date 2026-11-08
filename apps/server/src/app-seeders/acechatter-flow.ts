import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {decodeMetadataValues,encodeMetadataValue,type MetadataValueRow} from '../system-files/component-runtime.js';

type Field={object:string;name:string;label:string;type:string};
const fields:Field[]=[
 {object:'ChatConversation',name:'Name',label:'Name',type:'text'},
 {object:'ChatConversation',name:'PhoneNumber',label:'Phone Number',type:'phone'},
 {object:'ChatConversation',name:'Status',label:'Status',type:'text'},
 {object:'ChatConversation',name:'SourceObjectApi',label:'Source Object API',type:'text'},
 {object:'ChatConversation',name:'SourceRecordId',label:'Source Record ID',type:'text'},
 {object:'ChatMessage',name:'Name',label:'Name',type:'text'},
 {object:'ChatMessage',name:'ConversationId',label:'Conversation',type:'reference'},
 {object:'ChatMessage',name:'Body',label:'Body',type:'longtext'},
 {object:'ChatMessage',name:'Direction',label:'Direction',type:'text'},
 {object:'ChatMessage',name:'SentAt',label:'Sent At',type:'datetime'},
 {object:'ChatMessage',name:'Status',label:'Status',type:'text'},
 {object:'ChatMessage',name:'ExternalMessageId',label:'Provider Message ID',type:'text'},
 {object:'ChatChannelSettings',name:'Name',label:'Name',type:'text'},
 {object:'ChatChannelSettings',name:'PhoneNumberId',label:'WhatsApp Phone Number ID',type:'text'},
 {object:'ChatChannelSettings',name:'Active',label:'Active',type:'boolean'}
];
const links=(...ids:number[])=>ids.slice(0,-1).map((from,i)=>({from,to:ids[i+1],kind:'normal',label:'Next'}));
function graph(apiName:string,label:string,object:string,input:string,conditions:unknown[],sortField:string,sortOrder='Ascending',recordLimit='all',conditionLogic?:string){
 const collection=object==='ChatConversation'?'conversations':object==='Communication'?'communications':object==='Contact'?'contacts':'messages';
 return {apiName,label,appApiName:'AceChatter',flowType:'Autolaunched Flow',
  status:'Active',version:1,tests:[],resources:[
   {name:input,type:'Variable',dataType:'Text',availableForInput:true},
   {name:collection,type:'Record Collection',dataType:object,availableForOutput:true}
  ],elements:[
   {id:1,type:'Start',label:'Start',config:{executionContext:'User'}},
   {id:2,type:'Get Records',label:'Authorised '+object,config:{
     object,recordLimit,outputVariable:collection,conditions,
     ...(conditionLogic?{conditionLogic}:{}),sortField,sortOrder}},
   {id:3,type:'End',label:'End',config:{}}
  ],connectors:links(1,2,3)};
}
async function insertGraph(client:PoolClient,tenantId:string,graphValue:ReturnType<typeof graph>,active:boolean) {
 const existing=await client.query(
  'SELECT 1 FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 LIMIT 1',
  [tenantId,graphValue.apiName]);
 if(existing.rowCount)return false; // Preserve every tenant-authored version.
 const {rows}=await client.query<{id:string}>(`
  INSERT INTO md_flow_definitions(tenant_id,api_name,label,flow_type,version,active)
  VALUES($1,$2,$3,'Autolaunched Flow',1,$4) RETURNING id`,
  [tenantId,graphValue.apiName,graphValue.label,active]);
 const encoded:Array<{path:string;kind:string;text:string|null}>=[];
 encodeMetadataValue(graphValue,'/builder',encoded);
 for(const property of encoded)await client.query(`
  INSERT INTO md_flow_editor_values(tenant_id,flow_id,property_path,value_kind,value_text)
  VALUES($1,$2,$3,$4,$5)`,
  [tenantId,rows[0].id,property.path,property.kind,property.text]);
 return true;
}
/** Repair the known default inbox Flow on already-installed tenants.
 * Older seeded versions omitted conditionLogic, which makes Get Records AND all
 * three filters. That excludes inbound messages when searching by the sender's
 * number because the business recipient is a different number. Only migrate the
 * exact, uncustomised seeded graph; leave tenant-authored Flow changes untouched.
 * CreatedAt is not a registered Communication field accepted by Flow validation;
 * migrate that obsolete seeded sort to the registered ReceivedAt timestamp.
 */
export async function reconcileAceChatterLoadCommunicationsFlow(client:PoolClient,tenantId:string):Promise<boolean>{
 const {rows:flows}=await client.query<{id:string}>(`
  SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name='AceChatterLoadCommunications'
   AND archived=false ORDER BY version DESC LIMIT 1 FOR UPDATE`,[tenantId]);
 const flowId=flows[0]?.id;
 if(!flowId)return false;
 const {rows}=await client.query<MetadataValueRow>(`
  SELECT property_path,value_kind,value_text FROM md_flow_editor_values
   WHERE tenant_id=$1 AND flow_id=$2 ORDER BY property_path`,[tenantId,flowId]);
 if(!rows.length)return false;
 const source=decodeMetadataValues(rows).builder;
 if(!source||typeof source!=='object'||Array.isArray(source))return false;
 const graph=source as Record<string,unknown>;
 if(!Array.isArray(graph.elements)||!Array.isArray(graph.connectors))return false;
 const elements=graph.elements as Array<{id:number;type:string;config?:Record<string,unknown>}>;
 const connectors=graph.connectors as Array<{from:number;to:number}>;
 const get=elements.find(node=>node.id===2);
 const expectedConditions=[
  {field:'Channel',operator:'Equals',value:'WhatsApp'},
  {field:'Sender',operator:'Contains',value:'@searchTerm'},
  {field:'Recipient',operator:'Contains',value:'@searchTerm'}
 ];
 if(elements.length!==3||connectors.length!==2
  ||elements.find(node=>node.id===1)?.type!=='Start'
  ||get?.type!=='Get Records'||get.config?.object!=='Communication'
  ||get.config?.outputVariable!=='communications'||get.config?.recordLimit!=='200'
  ||elements.find(node=>node.id===3)?.type!=='End'
  ||!connectors.some(edge=>edge.from===1&&edge.to===2)
  ||!connectors.some(edge=>edge.from===2&&edge.to===3)
  ||JSON.stringify(get.config.conditions)!==JSON.stringify(expectedConditions))return false;
 const currentLogic=get.config.conditionLogic;
 if(currentLogic!=='1 AND (2 OR 3)'&&currentLogic!==undefined&&currentLogic!==null&&currentLogic!==''&&currentLogic!=='All'
  &&currentLogic!=='1 AND 2 AND 3')return false;
 const obsoleteSort=get.config.sortField==='CreatedAt';
 if(currentLogic==='1 AND (2 OR 3)'&&!obsoleteSort)return false;
 get.config={...get.config,conditionLogic:'1 AND (2 OR 3)',
  ...(obsoleteSort?{sortField:'ReceivedAt'}:{})};
 const encoded:Array<{path:string;kind:string;text:string|null}>=[];
 encodeMetadataValue(graph,'/builder',encoded);
 await client.query('DELETE FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',[tenantId,flowId]);
 for(const item of encoded)await client.query(`
  INSERT INTO md_flow_editor_values(tenant_id,flow_id,property_path,value_kind,value_text)
  VALUES($1,$2,$3,$4,$5)`,[tenantId,flowId,item.path,item.kind,item.text]);
 await client.query(`
  INSERT INTO md_security_events(tenant_id,action,details)
  VALUES($1,'AceChatterInboxFlowReconciled',
   jsonb_build_object('flowId',$2::text,'conditionLogic','1 AND (2 OR 3)',
    'sortField',$3::text))`,[tenantId,flowId,get.config.sortField??null]);
 return true;
}

/** Migrate only the seeded, obsolete sender-settings lookup.
 * Do not reset published/customer-authored HTTP callouts or credential bindings. */
export async function reconcileAceChatterCredentialFlow(client:PoolClient,tenantId:string):Promise<boolean>{
 const {rows:flows}=await client.query<{id:string}>(`
  SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name='AceChatterSendMessage'
    AND archived=false ORDER BY version DESC LIMIT 1 FOR UPDATE`,[tenantId]);
 const flowId=flows[0]?.id;
 if(!flowId)return false;
 const {rows}=await client.query<MetadataValueRow>(`
  SELECT property_path,value_kind,value_text FROM md_flow_editor_values
   WHERE tenant_id=$1 AND flow_id=$2 ORDER BY property_path`,[tenantId,flowId]);
 if(!rows.length)return false;
 const source=decodeMetadataValues(rows).builder;
 if(!source||typeof source!=='object'||Array.isArray(source))return false;
 const graph=source as Record<string,unknown>;
 if(!Array.isArray(graph.elements)||!Array.isArray(graph.connectors))return false;
 const elements=graph.elements as Array<{id:number;type:string;config?:Record<string,unknown>}>;
 const connectors=graph.connectors as Array<{from:number;to:number;kind:string;label?:string}>;
 const stale=elements.find(item=>item.id===5);
 const outbound=elements.find(item=>item.id===2);
 // Guard against tenant-edited or nonstandard Flows.
 if(elements.length!==6||connectors.length!==5
  ||stale?.type!=='Get Records'||stale.config?.object!=='ChatChannelSettings'
  ||stale.config?.outputVariable!=='channel'||outbound?.type!=='HTTP Callout'
  ||outbound.config?.path!=='v26.0/{!public_phoneNumberId}/messages'
  ||!connectors.some(edge=>edge.from===4&&edge.to===5)
  ||!connectors.some(edge=>edge.from===5&&edge.to===2)
  ||connectors.some(edge=>edge.to===5&&edge.from!==4||edge.from===5&&edge.to!==2))
  return false;
 // Never change a Flow if other nodes still reference the old channel record.
 if(elements.some(item=>item.id!==5&&JSON.stringify(item.config??{}).includes('{!channel.')))
  return false;
 graph.elements=elements.filter(item=>item.id!==5);
 graph.connectors=connectors.filter(edge=>edge.from!==5).map(edge=>
  edge.from===4&&edge.to===5?{...edge,to:2}:edge);
 const encoded:Array<{path:string;kind:string;text:string|null}>=[];
 encodeMetadataValue(graph,'/builder',encoded);
 await client.query('DELETE FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',
  [tenantId,flowId]);
 for(const item of encoded)await client.query(`
  INSERT INTO md_flow_editor_values(tenant_id,flow_id,property_path,value_kind,value_text)
  VALUES($1,$2,$3,$4,$5)`,[tenantId,flowId,item.path,item.kind,item.text]);
 await client.query(`
  INSERT INTO md_security_events(tenant_id,action,details)
  VALUES($1,'AceChatterCredentialFlowReconciled',
   jsonb_build_object('flowId',$2::text,'removedNode',5,'preservedCredential',true))`,
  [tenantId,flowId]);
 return true;
}

/** Add contact provenance only to the unchanged seeded create-conversation Flow. */
/** Move outbound Communication creation from the seeded Flow into the shared HTTP Callout runtime.
 * Only the known seeded graph is reconciled; customer-authored graph structure is preserved. */
export async function reconcileAceChatterCommunicationFlow(client:PoolClient,tenantId:string):Promise<boolean>{
 const {rows:flows}=await client.query<{id:string}>(`
  SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name='AceChatterSendMessage'
    AND archived=false ORDER BY version DESC LIMIT 1 FOR UPDATE`,[tenantId]);
 const flowId=flows[0]?.id;
 if(!flowId)return false;
 const {rows}=await client.query<MetadataValueRow>(`
  SELECT property_path,value_kind,value_text FROM md_flow_editor_values
   WHERE tenant_id=$1 AND flow_id=$2 ORDER BY property_path`,[tenantId,flowId]);
 if(!rows.length)return false;
 const source=decodeMetadataValues(rows).builder;
 if(!source||typeof source!=='object'||Array.isArray(source))return false;
 const graph=source as Record<string,unknown>;
 if(!Array.isArray(graph.elements)||!Array.isArray(graph.connectors))return false;
 const elements=graph.elements as Array<{id:number;type:string;label?:string;config?:Record<string,unknown>}>;
 const connectors=graph.connectors as Array<{from:number;to:number;kind:string;label?:string}>;
 const recipient=elements.find(item=>item.id===4);
 const outbound=elements.find(item=>item.id===2);
 const saveMessage=elements.find(item=>item.id===6);
 const communication=elements.find(item=>item.id===7&&item.type==='Create Records'
  &&item.config?.object==='Communication');
 const expectedCommunicationFields=[
  {field:'Name',value:'WhatsApp outbound'},{field:'Channel',value:'WhatsApp'},
  {field:'Direction',value:'Outbound'},{field:'Status',value:'Sent'},
  {field:'Sender',value:'WhatsApp Business'},{field:'Recipient',value:'@conversation.PhoneNumber'},
  {field:'Body',value:'@message'},{field:'ExternalMessageId',value:'@providerMessageId'},
  {field:'Provider',value:'WhatsApp'}
 ];
 const actualCommunicationFields=communication?.config?.fieldValues;
 const knownCommunicationNode=Boolean(communication
  &&communication.label==='Record outbound Communication'
  &&Object.keys(communication.config??{}).sort().join(',')==='fieldValues,object'
  &&Array.isArray(actualCommunicationFields)
  &&actualCommunicationFields.length===expectedCommunicationFields.length
  &&expectedCommunicationFields.every((field,index)=>{
   const actual=actualCommunicationFields[index] as Record<string,unknown>;
   return actual?.field===field.field&&actual?.value===field.value;
  }));
 const hasEdge=(edges:typeof connectors,from:number,to:number)=>
  edges.some(edge=>edge.from===from&&edge.to===to);
 const commonShape=recipient?.type==='Get Records'
  &&recipient.config?.object==='ChatConversation'
  &&recipient.config?.outputVariable==='conversation'
  &&outbound?.type==='HTTP Callout'
  &&['v26.0/{!public_phoneNumberId}/messages',
    'v26.0/{!phoneNumberId}/messages'].includes(String(outbound.config?.path))
  &&saveMessage?.type==='Create Records'&&saveMessage.config?.object==='ChatMessage'
  &&elements.find(item=>item.id===1)?.type==='Start'
  &&elements.find(item=>item.id===3)?.type==='End';
 if(!commonShape||!outbound)return false;
 const oldSeededShape=knownCommunicationNode&&elements.length===6&&connectors.length===5
  &&elements.every(item=>[1,2,3,4,6,7].includes(item.id))
  &&hasEdge(connectors,1,4)&&hasEdge(connectors,4,2)&&hasEdge(connectors,2,6)
  &&hasEdge(connectors,6,7)&&hasEdge(connectors,7,3);
 const newSeededShape=!communication&&elements.length===5&&connectors.length===4
  &&elements.every(item=>[1,2,3,4,6].includes(item.id))
  &&hasEdge(connectors,1,4)&&hasEdge(connectors,4,2)&&hasEdge(connectors,2,6)
  &&hasEdge(connectors,6,3);
 if(!oldSeededShape&&!newSeededShape)return false;

 let changed=false;
 let nextElements=elements;
 let nextConnectors=connectors;
 if(oldSeededShape){
  nextElements=elements.filter(item=>item.id!==7);
  nextConnectors=connectors.filter(edge=>edge.from!==7&&edge.to!==7);
  if(!hasEdge(nextConnectors,6,3))
   nextConnectors=[...nextConnectors,{from:6,to:3,kind:'normal',label:'Next'}];
  changed=true;
 }
 const existingMapping=outbound.config?.communicationLog;
 if(!existingMapping){
  outbound.config={...outbound.config,communicationLog:{
   channel:'WhatsApp',name:'WhatsApp outbound',sender:'WhatsApp Business',
   recipient:'{!conversation.PhoneNumber}',body:'{!message}',provider:'WhatsApp',
   externalMessageIdResponsePath:'messages[0].id'
  }};
  changed=true;
 }
 if(!changed)return false;
 graph.elements=nextElements;
 graph.connectors=nextConnectors;
 const encoded:Array<{path:string;kind:string;text:string|null}>=[];
 encodeMetadataValue(graph,'/builder',encoded);
 await client.query('DELETE FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',[tenantId,flowId]);
 for(const item of encoded)await client.query(`
  INSERT INTO md_flow_editor_values(tenant_id,flow_id,property_path,value_kind,value_text)
  VALUES($1,$2,$3,$4,$5)`,[tenantId,flowId,item.path,item.kind,item.text]);
 await client.query(`
  INSERT INTO md_security_events(tenant_id,action,details)
  VALUES($1,'AceChatterCommunicationFlowReconciled',
   jsonb_build_object('flowId',$2::text,'removedFlowCommunicationNode',true,
    'writesCentralCommunication',true))`,[tenantId,flowId]);
 return true;
}

export async function reconcileAceChatterCreateConversationContactFields(client:PoolClient,tenantId:string):Promise<boolean>{
 const {rows:flows}=await client.query<{id:string}>(`
  SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name='AceChatterCreateConversation'
    AND archived=false ORDER BY version DESC LIMIT 1 FOR UPDATE`,[tenantId]);
 const flowId=flows[0]?.id;
 if(!flowId)return false;
 const {rows}=await client.query<MetadataValueRow>(`
  SELECT property_path,value_kind,value_text FROM md_flow_editor_values
   WHERE tenant_id=$1 AND flow_id=$2 ORDER BY property_path`,[tenantId,flowId]);
 if(!rows.length)return false;
 const source=decodeMetadataValues(rows).builder;
 if(!source||typeof source!=='object'||Array.isArray(source))return false;
 const graph=source as Record<string,unknown>;
 if(!Array.isArray(graph.resources)||!Array.isArray(graph.elements)||!Array.isArray(graph.connectors))return false;
 const resources=graph.resources as Array<Record<string,unknown>>;
 const elements=graph.elements as Array<{id:number;type:string;config?:Record<string,unknown>}>;
 const connectors=graph.connectors as Array<{from:number;to:number;kind:string;label?:string}>;
 const create=elements.find(node=>node.id===4);
 const fieldsValue=create?.config?.fieldValues;
 if(resources.some(item=>item.name==='sourceObjectApi')&&resources.some(item=>item.name==='sourceRecordId')
  &&Array.isArray(fieldsValue)&&fieldsValue.some(item=>(item as Record<string,unknown>)?.field==='SourceObjectApi')
  &&fieldsValue.some(item=>(item as Record<string,unknown>)?.field==='SourceRecordId'))return false;
 // Fail closed if the tenant has customised the existing Flow.
 if(elements.length!==5||connectors.length!==5
  ||elements.find(node=>node.id===1)?.type!=='Start'
  ||elements.find(node=>node.id===2)?.type!=='Get Records'
  ||elements.find(node=>node.id===2)?.config?.object!=='ChatConversation'
  ||elements.find(node=>node.id===2)?.config?.outputVariable!=='existing'
  ||elements.find(node=>node.id===3)?.type!=='Decision'
  ||create?.type!=='Create Records'||create.config?.object!=='ChatConversation'
  ||elements.find(node=>node.id===5)?.type!=='End'
  ||!connectors.some(edge=>edge.from===1&&edge.to===2)
  ||!connectors.some(edge=>edge.from===2&&edge.to===3)
  ||!connectors.some(edge=>edge.from===3&&edge.to===4&&edge.label==='New')
  ||!connectors.some(edge=>edge.from===3&&edge.to===5&&edge.label==='Default')
  ||!connectors.some(edge=>edge.from===4&&edge.to===5))return false;
 const oldFields=Array.isArray(fieldsValue)?fieldsValue as Array<Record<string,unknown>>:[];
 if(oldFields.length!==3||!['Name','PhoneNumber','Status'].every(field=>oldFields.some(item=>item.field===field)))return false;
 if(!resources.some(item=>item.name==='chatName'&&item.availableForInput===true)
  ||!resources.some(item=>item.name==='phoneNumber'&&item.availableForInput===true))return false;
 resources.push({name:'sourceObjectApi',type:'Variable',dataType:'Text',availableForInput:true});
 resources.push({name:'sourceRecordId',type:'Variable',dataType:'Text',availableForInput:true});
 create.config={...create.config,fieldValues:[...oldFields,
  {field:'SourceObjectApi',value:'@sourceObjectApi'},
  {field:'SourceRecordId',value:'@sourceRecordId'}]};
 const encoded:Array<{path:string;kind:string;text:string|null}>=[];
 encodeMetadataValue(graph,'/builder',encoded);
 await client.query('DELETE FROM md_flow_editor_values WHERE tenant_id=$1 AND flow_id=$2',[tenantId,flowId]);
 for(const item of encoded)await client.query(`
  INSERT INTO md_flow_editor_values(tenant_id,flow_id,property_path,value_kind,value_text)
  VALUES($1,$2,$3,$4,$5)`,[tenantId,flowId,item.path,item.kind,item.text]);
 await client.query(`INSERT INTO md_security_events(tenant_id,action,details)
  VALUES($1,'AceChatterContactLinkFlowReconciled',jsonb_build_object('flowId',$2::text,'fieldsAdded',2))`,
  [tenantId,flowId]);
 return true;
}

/** Idempotently seed only a licensed/installed AceChatter tenant, never user grants or business chats. */
export async function seedAceChatterFlowsForTenant(client:PoolClient,tenantId:string):Promise<number>{
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenantId+':flows:AceChatter']);
 for(const item of [{name:'ChatConversation',label:'Chat Conversation'},
   {name:'ChatMessage',label:'Chat Message'},
   {name:'ChatChannelSettings',label:'WhatsApp Channel Settings'}])
  await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
   VALUES($1,$2,$3,false) ON CONFLICT(tenant_id,api_name) DO NOTHING`,
   [tenantId,item.name,item.label]);
 for(const field of fields)await client.query(`
  INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object)
  VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
  [tenantId,field.object,field.name,field.label,field.type,
   field.name==='ConversationId'?'ChatConversation':null]);
 // Policy exists for explicit administrator assignment; no automatic user grants.
 await client.query(`INSERT INTO md_permission_sets
  (tenant_id,api_name,label,description,navigation_default_access)
  VALUES($1,'AceChatterUser','AceChatter User',
   'Read assigned chats and execute authorised AceChatter Flows','Deny')
  ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId]);
 const rights=[
  ['App:AceChatter','read'],
  ['Flow:AceChatterLoadConversations','execute'],
  ['Flow:AceChatterLoadContacts','execute'],
  ['Flow:AceChatterLoadMessages','execute'],
  ['Flow:AceChatterLoadCommunications','execute'],
  ['Flow:AceChatterFindConversationByPhone','execute'],
  ['Communication','read'],['Communication','create'],
  ...['Name','Channel','Direction','Status','Sender','Recipient','Body','ExternalMessageId','ReceivedAt','SentAt','Provider'].map(field=>['Communication.'+field,'read']),
  ...['Name','Channel','Direction','Status','Sender','Recipient','Body','ExternalMessageId','SentAt','Provider'].map(field=>['Communication.'+field,'create']),
  ['Flow:AceChatterSendMessage','execute'],
  ['Flow:AceChatterCreateConversation','execute'],
  ['Flow:AceChatterReceiveWebhook','execute'],
  ['ChatConversation','read'],['ChatConversation','create'],
  ['ChatConversation.SourceObjectApi','create'],['ChatConversation.SourceRecordId','create'],
  ['ChatMessage','read'],['ChatMessage','create'],['ChatChannelSettings','read'],
  ...fields.map(field=>[field.object+'.'+field.name,'read'])
 ];
 for(const [resource,action] of rights)await client.query(`
  INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
  SELECT $1,p.id,$2,$3,'allow' FROM md_permission_sets p
  WHERE p.tenant_id=$1 AND p.api_name='AceChatterUser'
  ON CONFLICT DO NOTHING`,[tenantId,resource,action]);
 const oneEngineCommunicationRights=[
  ['Flow:AceChatterLoadCommunications','execute'],
  ['Communication','read'],
  ...['Name','Channel','Direction','Status','Sender','Recipient','Body','ExternalMessageId',
   'ReceivedAt','SentAt','Provider'].map(field=>['Communication.'+field,'read'])
 ];
 for(const [resource,action] of oneEngineCommunicationRights)await client.query(`
  INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
  SELECT $1,p.id,$2,$3,'allow' FROM md_permission_sets p
  WHERE p.tenant_id=$1 AND p.api_name='OneEngine'
  ON CONFLICT DO NOTHING`,[tenantId,resource,action]);
 await reconcileAceChatterLoadCommunicationsFlow(client,tenantId);
 await reconcileAceChatterCredentialFlow(client,tenantId);
 await reconcileAceChatterCommunicationFlow(client,tenantId);
 const definitions=[
  graph('AceChatterLoadConversations','AceChatter - Load Conversations',
   'ChatConversation','searchTerm',[
    {field:'Name',operator:'Contains',value:'@searchTerm'}],'Name'),
  graph('AceChatterLoadMessages','AceChatter - Load Messages',
   'ChatMessage','conversationId',[
    {field:'ConversationId',operator:'Equals',value:'@conversationId'}],'SentAt'),
  graph('AceChatterLoadContacts','AceChatter - Load User-Linked Contacts',
   'Contact','searchTerm',[
    {field:'OwnerId',operator:'Equals',value:'{!$User.Id}'},
    {field:'Name',operator:'Contains',value:'@searchTerm'}
   ],'Name','Ascending','all'),
  graph('AceChatterLoadCommunications','AceChatter - Load WhatsApp Communications',
   'Communication','searchTerm',[
    {field:'Channel',operator:'Equals',value:'WhatsApp'},
    {field:'Sender',operator:'Contains',value:'@searchTerm'},
    {field:'Recipient',operator:'Contains',value:'@searchTerm'}
   ],'ReceivedAt','Descending','200','1 AND (2 OR 3)'),
  graph('AceChatterFindConversationByPhone','AceChatter - Find Conversation by Phone',
   'ChatConversation','phoneNumber',[
    {field:'PhoneNumber',operator:'Equals',value:'@phoneNumber'}
   ],'Name','Ascending','200')
 ];
 const contactsFlow=definitions.find(value=>value.apiName==='AceChatterLoadContacts') as unknown as {
  resources:Array<Record<string,unknown>>;
  elements:Array<{id:number;type:string;label:string;config:Record<string,unknown>}>;
  connectors:Array<{from:number;to:number;kind:string;label?:string}>;
 }|undefined;
 if(contactsFlow){
  contactsFlow.resources.push({name:'sourceObjectApi',type:'Variable',dataType:'Text',availableForOutput:true});
  contactsFlow.elements[1].config={...contactsFlow.elements[1].config,conditionLogic:'All',
   fields:['Name','FirstName','LastName','Phone','Mobile','Email']};
  contactsFlow.elements[2]={id:3,type:'Assignment',label:'Set contact source object',
   config:{variable:'sourceObjectApi',operator:'Assign',value:'Contact'}};
  contactsFlow.elements.push({id:4,type:'End',label:'End',config:{}});
  contactsFlow.connectors=links(1,2,3,4);
 }
 let seeded=0;
 for(const value of definitions){
  if(value.apiName==='AceChatterLoadContacts'){
   const {rows:contactObject}=await client.query('SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',[tenantId,'Contact']);
   value.status=contactObject.length?'Active':'Draft';
   if(await insertGraph(client,tenantId,value,contactObject.length>0))seeded++;
  }else if(await insertGraph(client,tenantId,value,true))seeded++;
 }
 const createChat={
  apiName:'AceChatterCreateConversation',label:'AceChatter - New Conversation',
  appApiName:'AceChatter',flowType:'Autolaunched Flow',status:'Active',version:1,tests:[],
  resources:[
   {name:'chatName',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'phoneNumber',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'sourceObjectApi',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'sourceRecordId',type:'Variable',dataType:'Text',availableForInput:true}
  ],elements:[
   {id:1,type:'Start',label:'Start',config:{executionContext:'User'}},
   {id:2,type:'Get Records',label:'Find existing phone',config:{
    object:'ChatConversation',recordLimit:'1',outputVariable:'existing',
    conditions:[{field:'PhoneNumber',operator:'Equals',value:'@phoneNumber'}]}},
   {id:3,type:'Decision',label:'New phone?',config:{outcomes:[
    {name:'New',label:'New',conditions:[{field:'@existing',operator:'Is Null'}]},
    {name:'Default',label:'Default'}]}},
   {id:4,type:'Create Records',label:'Create conversation',config:{
    object:'ChatConversation',fieldValues:[
     {field:'Name',value:'@chatName'},{field:'PhoneNumber',value:'@phoneNumber'},
     {field:'Status',value:'Open'},{field:'SourceObjectApi',value:'@sourceObjectApi'},
     {field:'SourceRecordId',value:'@sourceRecordId'}]}},
   {id:5,type:'End',label:'End',config:{}}
  ],connectors:[
   ...links(1,2,3),{from:3,to:4,kind:'normal',label:'New'},
   {from:3,to:5,kind:'normal',label:'Default'},...links(4,5)]
 };
 if(await insertGraph(client,tenantId,createChat as ReturnType<typeof graph>,true))seeded++;
 await reconcileAceChatterCreateConversationContactFields(client,tenantId);
 const receive={
  apiName:'AceChatterReceiveWebhook',label:'AceChatter - Receive WhatsApp Webhook',
  appApiName:'AceChatter',flowType:'Autolaunched Flow',status:'Active',version:1,tests:[],
  resources:[
   {name:'webhookPayloadJson',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'requestId',type:'Variable',dataType:'Text',availableForInput:true}
  ],elements:[
   {id:1,type:'Start',label:'Start',config:{executionContext:'User'}},
   {id:2,type:'Parse JSON',label:'Extract verified WhatsApp text',config:{
    source:'@webhookPayloadJson',assignments:[
     {path:'entry[0].changes[0].value.messages[0].id',outputVariable:'providerMessageId'},
     {path:'entry[0].changes[0].value.messages[0].from',outputVariable:'fromPhone'},
     {path:'entry[0].changes[0].value.messages[0].text.body',outputVariable:'messageBody'},
     {path:'entry[0].changes[0].value.contacts[0].profile.name',outputVariable:'contactName'},
     {path:'entry[0].changes[0].value.statuses[0].id',outputVariable:'statusMessageId'},
     {path:'entry[0].changes[0].value.statuses[0].status',outputVariable:'deliveryStatus'}
    ]}},
   {id:3,type:'Decision',label:'Message or receipt?',config:{outcomes:[
    {name:'Message',label:'Message',conditions:[{field:'@providerMessageId',operator:'Is Not Null'}]},
    {name:'Receipt',label:'Receipt',conditions:[{field:'@statusMessageId',operator:'Is Not Null'}]},
    {name:'Default',label:'Default'}]}},
   {id:4,type:'Get Records',label:'Find existing message',config:{
    object:'ChatMessage',recordLimit:'1',outputVariable:'previousMessage',
    conditions:[{field:'ExternalMessageId',operator:'Equals',value:'@providerMessageId'}]}},
   {id:5,type:'Decision',label:'Unseen message?',config:{outcomes:[
    {name:'New',label:'New',conditions:[{field:'@previousMessage',operator:'Is Null'}]},
    {name:'Default',label:'Default'}]}},
   {id:6,type:'Get Records',label:'Find sender conversation',config:{
    object:'ChatConversation',recordLimit:'1',outputVariable:'existingConversation',
    conditions:[{field:'PhoneNumber',operator:'Equals',value:'@fromPhone'}]}},
   {id:7,type:'Decision',label:'New sender?',config:{outcomes:[
    {name:'New',label:'New',conditions:[{field:'@existingConversation',operator:'Is Null'}]},
    {name:'Default',label:'Default'}]}},
   {id:8,type:'Create Records',label:'Create sender',config:{
    object:'ChatConversation',fieldValues:[
     {field:'Name',value:'@contactName'},{field:'PhoneNumber',value:'@fromPhone'},
     {field:'Status',value:'Open'}]}},
   {id:9,type:'Get Records',label:'Resolve conversation',config:{
    object:'ChatConversation',recordLimit:'1',outputVariable:'conversation',
    conditions:[{field:'PhoneNumber',operator:'Equals',value:'@fromPhone'}]}},
   {id:10,type:'Create Records',label:'Save inbound text',config:{
    object:'ChatMessage',fieldValues:[
     {field:'Name',value:'WhatsApp inbound'},
     {field:'ConversationId',value:'@conversation.Id'},
     {field:'ExternalMessageId',value:'@providerMessageId'},
     {field:'Body',value:'@messageBody'},
     {field:'Direction',value:'Inbound'},{field:'Status',value:'Received'}]}},
   {id:11,type:'Get Records',label:'Find receipt message',config:{
    object:'ChatMessage',recordLimit:'1',outputVariable:'receiptMessage',
    conditions:[{field:'ExternalMessageId',operator:'Equals',value:'@statusMessageId'}]}},
   {id:12,type:'Decision',label:'Receipt matching?',config:{outcomes:[
    {name:'Found',label:'Found',conditions:[{field:'@receiptMessage',operator:'Is Not Null'}]},
    {name:'Default',label:'Default'}]}},
   {id:13,type:'Update Records',label:'Set delivery status',config:{
    object:'ChatMessage',recordSource:'record',recordVariable:'receiptMessage',
    fieldValues:[{field:'Status',value:'@deliveryStatus'}]}},
   {id:14,type:'End',label:'End',config:{}}
  ],connectors:[
   ...links(1,2,3),{from:3,to:4,kind:'normal',label:'Message'},
   {from:3,to:11,kind:'normal',label:'Receipt'},
   {from:3,to:14,kind:'normal',label:'Default'},
   ...links(4,5),{from:5,to:6,kind:'normal',label:'New'},
   {from:5,to:14,kind:'normal',label:'Default'},
   ...links(6,7),{from:7,to:8,kind:'normal',label:'New'},
   {from:7,to:9,kind:'normal',label:'Default'},
   ...links(8,9,10,14),...links(11,12),
   {from:12,to:13,kind:'normal',label:'Found'},
   {from:12,to:14,kind:'normal',label:'Default'},...links(13,14)
  ]
 };
 if(await insertGraph(client,tenantId,receive as ReturnType<typeof graph>,true))seeded++;
 // Never activate a fake send: the tenant must author and connect a provider
 // Named Credential / callout first. Keep the editable Flow safely Draft.
 const sendDraft={
  apiName:'AceChatterSendMessage',label:'AceChatter - Send Message',
  appApiName:'AceChatter',flowType:'Autolaunched Flow',
  status:'Draft',version:1,tests:[],
  resources:[
   {name:'conversationId',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'message',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'recipientPhone',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'phoneNumberId',type:'Variable',dataType:'Text',availableForInput:true},
   {name:'providerMessageId',type:'Variable',dataType:'Text'}
  ],
  elements:[
   {id:1,type:'Start',label:'Start',config:{executionContext:'User'}},
   {id:4,type:'Get Records',label:'Authorised WhatsApp recipient',config:{
     object:'ChatConversation',recordLimit:'1',outputVariable:'conversation',
     conditions:[{field:'Id',operator:'Equals',value:'@conversationId'}]}},
   {id:2,type:'HTTP Callout',label:'Configure WhatsApp Named Credential',config:{
     method:'POST',path:'v26.0/{!public_phoneNumberId}/messages',
     body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',
       to:'{!conversation.PhoneNumber}',type:'text',text:{preview_url:false,body:'{!message}'}}),
     communicationLog:{channel:'WhatsApp',name:'WhatsApp outbound',sender:'WhatsApp Business',
       recipient:'{!conversation.PhoneNumber}',body:'{!message}',provider:'WhatsApp',
       externalMessageIdResponsePath:'messages[0].id'},
     onError:'FAIL',responseMapping:JSON.stringify({providerMessageId:'messages[0].id'})}},
   {id:6,type:'Create Records',label:'Record accepted WhatsApp message',config:{
     object:'ChatMessage',fieldValues:[
      {field:'Name',value:'WhatsApp outbound'},
      {field:'ConversationId',value:'@conversation.Id'},
      {field:'Body',value:'@message'},{field:'Direction',value:'Outbound'},
      {field:'Status',value:'Accepted'},{field:'ExternalMessageId',value:'@providerMessageId'}]}},
   {id:3,type:'End',label:'End',config:{}}
  ],connectors:links(1,4,2,6,3)
 };
 if(await insertGraph(client,tenantId,sendDraft as ReturnType<typeof graph>,false))seeded++;
 return seeded;
}
export async function seedAceChatterFlows(db:SqlPersistence):Promise<number>{
 const {rows}=await db.query<{tenant_id:string}>(`
  SELECT DISTINCT i.tenant_id FROM md_app_installations i
  JOIN md_apps a ON a.id=i.app_id AND a.api_name='AceChatter' AND a.enabled=true
  JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=i.tenant_id
  WHERE e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())`);
 let count=0;
 for(const row of rows)count+=await db.transaction(c=>seedAceChatterFlowsForTenant(c,row.tenant_id));
 return count;
}
