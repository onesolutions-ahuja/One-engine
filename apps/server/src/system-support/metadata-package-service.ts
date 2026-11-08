import {createHash} from 'node:crypto';
import type {Express,NextFunction,Request,Response} from 'express';
import type {PoolClient,QueryResultRow} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import type {PageRuntime} from '../system-files/page-runtime.js';
import type {ComponentLibraryService} from './component-library-service.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {ObjectManagerMetadataService} from '../system-files/object-manager-metadata.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import type {RbacAdministration} from './rbac-administration.js';
import {randomUUID} from 'node:crypto';

type Actor={tenant_id:string;user_id:string};
type AuthenticatedRequest=Request&{actor?:Actor};
type MetadataObject={apiName:string;label:string;kind:string;fields:Array<Record<string,unknown>>};
type MetadataPage=Record<string,unknown>&{apiName:string;revision?:number;status?:string};
type LibraryComponent=Record<string,unknown>&{apiName:string;status?:string;version?:number};
type PackageFlow=Record<string,unknown>&{apiName:string;label:string;flowType:string;elements:unknown[];connectors:unknown[]};
type ObjectConfiguration=Record<string,unknown>&{apiName:string;configuration:Record<string,unknown>;
 pageLayouts:unknown[];pageLayoutAssignments:unknown[];recordTypes:unknown[]};
type PackagePermissionSet=Record<string,unknown>&{apiName:string;label:string};
type Dependency={type:'object'|'app'|'component'|'global-value-set';apiName:string};
type PackageContent={
 objects:MetadataObject[];
 pages:MetadataPage[];
 components:LibraryComponent[];
 flows?:PackageFlow[];
 objectConfigurations?:ObjectConfiguration[];
 permissionSets?:PackagePermissionSet[];
};
type PackageSelection={apiName:string;label:string;version:number;type:'Managed'|'Unlocked';
 objects:unknown;pages:unknown;components:unknown;flows?:unknown;objectConfigurations?:unknown;permissionSets?:unknown};
type PortableProfile={id:string;apiName:string};
export type MetadataPackage={
 format:'metadrive-metadata-package';
 schemaVersion:1;
 package:{apiName:string;label:string;version:number;type:'Managed'|'Unlocked'};
 dependencies:Dependency[];
 contents:PackageContent;
 digest:string;
};
type Preview={
 canInstall:boolean;
 operation:'install'|'upgrade'|'reinstall';
 missingDependencies:Dependency[];
 conflicts:Array<{type:string;apiName:string;reason:string}>;
 preservedCustomizations:Array<{type:string;apiName:string}>;
};
const apiNamePattern=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const canonicalPackage=(value:Omit<MetadataPackage,'digest'>)=>JSON.stringify(value);
const digestOf=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const definitionFields=(value:MetadataObject)=>value.fields.map(({id:_id,...field})=>field);
const objectDigest=(value:MetadataObject)=>digestOf({
 apiName:value.apiName,label:value.label,kind:value.kind,fields:definitionFields(value)
});
const pageProjection=(page:MetadataPage)=>{
 const {id:_id,revision:_revision,updatedAt:_updatedAt,...value}=page;
 return value;
};
const pageDigest=(page:MetadataPage)=>digestOf(pageProjection(page));
const flowProjection=(flow:PackageFlow)=>({
 apiName:flow.apiName,label:flow.label,flowType:flow.flowType,elements:flow.elements,
 connectors:flow.connectors,resources:flow.resources??[],startConfig:flow.startConfig??{},
 tests:flow.tests??[],triggerObject:flow.triggerObject??null,appApiName:flow.appApiName??null
});
const objectConfigurationDigest=(value:ObjectConfiguration)=>digestOf(value);
const permissionSetProjection=(value:PackagePermissionSet)=>{
 const {id:_id,...portable}=value;
 return portable;
};
function portableObjectConfiguration(apiName:string,configuration:Record<string,unknown>,
 object:Record<string,unknown>,profiles:PortableProfile[]):ObjectConfiguration{
 const layouts=Array.isArray(object.pageLayouts)?object.pageLayouts as Array<Record<string,unknown>>:[];
 const recordTypes=Array.isArray(object.recordTypes)?object.recordTypes as Array<Record<string,unknown>>:[];
 const layoutById=new Map(layouts.map(layout=>[String(layout.id),String(layout.label)]));
 const recordTypeById=new Map(recordTypes.map(type=>[String(type.id),String(type.developerName)]));
 const profileApiById=new Map(profiles.map(profile=>[profile.id,profile.apiName]));
 const assignments=Array.isArray(object.pageLayoutAssignments)
  ?(object.pageLayoutAssignments as Array<Record<string,unknown>>).flatMap(assignment=>{
   const profileApiName=profileApiById.get(String(assignment.profileId));
   const recordTypeDeveloperName=recordTypeById.get(String(assignment.recordTypeId));
   const pageLayoutLabel=layoutById.get(String(assignment.pageLayoutId));
   return profileApiName&&recordTypeDeveloperName&&pageLayoutLabel
    ?[{profileApiName,recordTypeDeveloperName,pageLayoutLabel}]:[];
  }):[];
 return {
  apiName,configuration,
  pageLayouts:layouts.map(layout=>({
   label:layout.label,
   sections:Array.isArray(layout.sections)?(layout.sections as Array<Record<string,unknown>>)
    .map(section=>({label:section.label,columns:section.columns,fieldApiNames:section.fieldApiNames})):[],
   actions:layout.actions??[],relatedLists:layout.relatedLists??[],
   customLinks:Array.isArray(layout.customLinks)?(layout.customLinks as Array<Record<string,unknown>>)
    .map(({label,url,openInNewWindow})=>({label,url,openInNewWindow})):[],
  })),
  pageLayoutAssignments:assignments,
  recordTypes:recordTypes.map(({developerName,label,description,active,isDefault,picklistValues})=>({
   developerName,label,description,active,isDefault,picklistValues
  }))
 };
}
const componentProjection=(component:LibraryComponent)=>{
 return {
  apiName:component.apiName,label:component.label,description:component.description,
  surfaces:component.surfaces,resize:component.resize,jsxSource:component.jsxSource,
  cssSource:component.cssSource,
  publicationStatus:component.publicationStatus??(component.status==='Published'?'Published':'Draft')
 };
};
const libraryDigest=(component:LibraryComponent)=>digestOf(componentProjection(component));
const makeBody=(value:Omit<MetadataPackage,'digest'>)=>value;
const parseStringList=(value:unknown,key:string):string[]=>{
 if(!Array.isArray(value)||value.length>200||value.some(item=>typeof item!=='string'||!apiNamePattern.test(item))
  ||new Set(value).size!==value.length)throw Error('Invalid package component list: '+key);
 return value as string[];
};
function validatePackage(raw:unknown):MetadataPackage{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid metadata package');
 const p=raw as Record<string,unknown>,info=p.package as Record<string,unknown>|undefined;
 const contents=p.contents as Record<string,unknown>|undefined;
 if(p.format!=='metadrive-metadata-package'||p.schemaVersion!==1||!info||typeof info!=='object'
  ||!contents||typeof contents!=='object'||Array.isArray(contents)
  ||typeof info.apiName!=='string'||!apiNamePattern.test(info.apiName)
  ||typeof info.label!=='string'||!info.label.trim()||info.label.length>200
  ||!Number.isSafeInteger(info.version)||Number(info.version)<1
  ||!['Managed','Unlocked'].includes(String(info.type))
  ||!Array.isArray(contents.objects)||contents.objects.length>200
  ||!Array.isArray(contents.pages)||contents.pages.length>200
  ||!Array.isArray(contents.components)||contents.components.length>200
  ||contents.flows!==undefined&&(!Array.isArray(contents.flows)||contents.flows.length>200)
  ||contents.objectConfigurations!==undefined&&(!Array.isArray(contents.objectConfigurations)
    ||contents.objectConfigurations.length>200)
  ||contents.permissionSets!==undefined&&(!Array.isArray(contents.permissionSets)
    ||contents.permissionSets.length>200)
  ||contents.objects.length+contents.pages.length+contents.components.length
    +(Array.isArray(contents.flows)?contents.flows.length:0)
    +(Array.isArray(contents.objectConfigurations)?contents.objectConfigurations.length:0)
    +(Array.isArray(contents.permissionSets)?contents.permissionSets.length:0)===0
  ||!Array.isArray(p.dependencies)||p.dependencies.length>1000
  ||typeof p.digest!=='string'||!/^[a-f0-9]{64}$/.test(p.digest))
  throw Error('Invalid metadata package');
 const objects=contents.objects as unknown[],pages=contents.pages as unknown[],components=contents.components as unknown[];
 const flows=(contents.flows??[]) as unknown[];
 const objectConfigurations=(contents.objectConfigurations??[]) as unknown[];
 const permissionSets=(contents.permissionSets??[]) as unknown[];
 for(const object of objects){
  if(!object||typeof object!=='object'||Array.isArray(object))throw Error('Invalid package object');
  const item=object as Record<string,unknown>;
  if(typeof item.apiName!=='string'||!apiNamePattern.test(item.apiName)
    ||typeof item.label!=='string'||!item.label.trim()||item.label.length>200
    ||item.kind!=='Custom Object'
    ||!Array.isArray(item.fields)||item.fields.length>1000
    ||(item.fields as unknown[]).some(field=>!field||typeof field!=='object'||Array.isArray(field)))
   throw Error('Invalid package object');
 }
 for(const page of pages){
  if(!page||typeof page!=='object'||Array.isArray(page))throw Error('Invalid package page');
  const item=page as Record<string,unknown>;
  if(typeof item.apiName!=='string'||!apiNamePattern.test(item.apiName)
   ||!Array.isArray(item.components)||item.components.length>400)
   throw Error('Invalid package page');
 }
 for(const component of components){
  if(!component||typeof component!=='object'||Array.isArray(component))throw Error('Invalid package component');
  const item=component as Record<string,unknown>;
  if(typeof item.apiName!=='string'||!apiNamePattern.test(item.apiName)
    ||typeof item.jsxSource!=='string'||item.jsxSource.length>100000
    ||typeof item.cssSource!=='string'||item.cssSource.length>100000)
   throw Error('Invalid package component');
 }
 for(const flow of flows){
  if(!flow||typeof flow!=='object'||Array.isArray(flow))throw Error('Invalid package Flow');
  const item=flow as Record<string,unknown>;
  if(typeof item.apiName!=='string'||!apiNamePattern.test(item.apiName)
   ||typeof item.label!=='string'||!item.label.trim()||item.label.length>200
   ||!['Screen Flow','Record-Triggered Flow','Autolaunched Flow','Schedule-Triggered Flow',
    'Platform Event-Triggered Flow'].includes(String(item.flowType))
   ||!Array.isArray(item.elements)||item.elements.length>250
   ||!Array.isArray(item.connectors)||item.connectors.length>500
   ||!Array.isArray(item.resources??[])||!Array.isArray(item.tests??[]))
   throw Error('Invalid package Flow');
 }
 for(const configuration of objectConfigurations){
  if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))throw Error('Invalid Object configuration');
  const item=configuration as Record<string,unknown>;
  if(typeof item.apiName!=='string'||!apiNamePattern.test(item.apiName)
   ||!item.configuration||typeof item.configuration!=='object'||Array.isArray(item.configuration)
   ||!Array.isArray(item.pageLayouts)||item.pageLayouts.length<1||item.pageLayouts.length>100
   ||!Array.isArray(item.pageLayoutAssignments)||item.pageLayoutAssignments.length>1000
   ||!Array.isArray(item.recordTypes)||item.recordTypes.length>100)
   throw Error('Invalid Object configuration');
 }
 for(const permissionSet of permissionSets){
  if(!permissionSet||typeof permissionSet!=='object'||Array.isArray(permissionSet))throw Error('Invalid package permission set');
  const item=permissionSet as Record<string,unknown>;
  if(typeof item.apiName!=='string'||!apiNamePattern.test(item.apiName)
   ||typeof item.label!=='string'||!item.label.trim()||item.label.length>120
   ||['OneEngine','PlatformDeveloper'].includes(item.apiName)||Object.hasOwn(item,'id')
   ||typeof item.systemPermissions!=='object'||Array.isArray(item.systemPermissions)
   ||!Array.isArray(item.advancedRules))
   throw Error('Invalid package permission set');
 }
 const dependencyList=p.dependencies as unknown[];
 if(dependencyList.some(item=>!item||typeof item!=='object'||Array.isArray(item)
  ||!['object','app','component','global-value-set'].includes(String((item as Record<string,unknown>).type))
  ||typeof (item as Record<string,unknown>).apiName!=='string'
  ||!apiNamePattern.test(String((item as Record<string,unknown>).apiName))))
  throw Error('Invalid package dependency');
 const body={
  format:'metadrive-metadata-package' as const,schemaVersion:1 as const,
  package:{apiName:info.apiName,label:info.label.trim(),version:Number(info.version),
   type:info.type as 'Managed'|'Unlocked'},
  dependencies:dependencyList as Dependency[],
  contents:{objects:objects as MetadataObject[],pages:pages as MetadataPage[],
   components:components as LibraryComponent[],
   ...(contents.flows!==undefined?{flows:flows as PackageFlow[]}:{}),
   ...(contents.objectConfigurations!==undefined?{objectConfigurations:objectConfigurations as ObjectConfiguration[]}:{}),
   ...(contents.permissionSets!==undefined?{permissionSets:permissionSets as PackagePermissionSet[]}:{})}
 };
 if(Buffer.byteLength(canonicalPackage(body))>1_000_000||digestOf(body)!==p.digest)
  throw Error('Metadata package integrity check failed');
 const names=new Set<string>();
 for(const item of [...body.contents.objects.map(x=>['object',x.apiName]),
   ...body.contents.pages.map(x=>['page',x.apiName]),
   ...body.contents.components.map(x=>['component',x.apiName]),
   ...(body.contents.flows??[]).map(x=>['flow',x.apiName]),
   ...(body.contents.objectConfigurations??[]).map(x=>['object-config',x.apiName]),
   ...(body.contents.permissionSets??[]).map(x=>['permission-set',x.apiName])]){
  const key=JSON.stringify(item);
  if(names.has(key))throw Error('Duplicate package component');
  names.add(key);
 }
 return {...body,digest:p.digest};
}

function packageScopedPersistence(client:PoolClient):SqlPersistence{
 let savepoint=0;
 return {
  query:<T extends QueryResultRow>(sql:string,params:readonly unknown[]=[])=>client.query<T>(sql,[...params]),
  transaction:async<T>(operation:(client:PoolClient)=>Promise<T>)=>{
   const name='metadata_package_'+(++savepoint);
   await client.query(`SAVEPOINT ${name}`);
   try{
    const result=await operation(client);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
   }catch(error){
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
   }
  }
 } as unknown as SqlPersistence;
}

export class MetadataPackageService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly definitions:ObjectDefinitionService,private readonly pages:PageRuntime,
  private readonly library:ComponentLibraryService,
  private readonly objectManager?:ObjectManagerMetadataService,
  private readonly flows?:FlowRuntime,
  private readonly rbacAdministration?:RbacAdministration){}
 private async readGrants(tenant:string,user:string){
  await Promise.all(['ObjectDefinition','FieldDefinition','PageDefinition','ComponentDefinition'].map(resource=>
   this.rbac.require(tenant,user,resource,'read')));
 }
 private async loaded(tenant:string,user:string){
  const [objects,pages,components]=await Promise.all([
   this.definitions.list(tenant),this.pages.list(tenant),this.library.list(tenant,user)
  ]);
  return {objects:objects as MetadataObject[],pages:pages as MetadataPage[],
   components:components as LibraryComponent[]};
 }
 private async portableFlow(tenant:string,flow:Record<string,unknown>){
  const clone=(value:unknown):unknown=>Array.isArray(value)?value.map(clone)
   :value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]))
   :value;
  const document=clone(flow) as Record<string,unknown>;
  const elements=Array.isArray(document.elements)?document.elements as Array<Record<string,unknown>>:[];
  for(const element of elements){
   const config=element.config&&typeof element.config==='object'&&!Array.isArray(element.config)
    ?element.config as Record<string,unknown>:undefined;
   const credentialId=config?.namedCredentialId;
   if(config&&typeof credentialId==='string'&&/^[0-9a-f-]{36}$/i.test(credentialId)){
    const {rows}=await this.db.query<{name:string}>(`
     SELECT name FROM md_named_credentials WHERE tenant_id=$1 AND id=$2 AND enabled=true`,
     [tenant,credentialId]);
    if(!rows[0])throw Error('Flow references an unavailable tenant credential');
    config.namedCredentialApiName=rows[0].name;
    delete config.namedCredentialId;
   }
  }
  const rejectIds=(value:unknown)=>{
   if(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw Error('Flow contains a tenant-specific ID that cannot be exported portably');
   if(Array.isArray(value))value.forEach(rejectIds);
   else if(value&&typeof value==='object')Object.values(value).forEach(rejectIds);
  };
  rejectIds(document);
  document.tests=[];
  return flowProjection(document as PackageFlow);
 }
 private async localizeFlow(tenant:string,flow:PackageFlow){
  const clone=(value:unknown):unknown=>Array.isArray(value)?value.map(clone)
   :value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]))
   :value;
  const document=clone(flow) as Record<string,unknown>;
  const elements=Array.isArray(document.elements)?document.elements as Array<Record<string,unknown>>:[];
  for(const element of elements){
   const config=element.config&&typeof element.config==='object'&&!Array.isArray(element.config)
    ?element.config as Record<string,unknown>:undefined;
   if(typeof config?.namedCredentialApiName==='string'){
    const {rows}=await this.db.query<{id:string}>(`
     SELECT id FROM md_named_credentials WHERE tenant_id=$1 AND name=$2 AND enabled=true`,
     [tenant,config.namedCredentialApiName]);
    if(!rows[0])throw Error('Flow requires a configured tenant Named Credential: '+config.namedCredentialApiName);
    config.namedCredentialId=rows[0].id;
    delete config.namedCredentialApiName;
   }
  }
  return document;
 }
 private dependencies(contents:PackageContent):Dependency[]{
  const internalObjects=new Set(contents.objects.map(item=>item.apiName));
  const internalComponents=new Set(contents.components.map(item=>item.apiName));
  const values=new Map<string,Dependency>();
  const add=(type:Dependency['type'],api:string)=>{
   if(api&&apiNamePattern.test(api))values.set(JSON.stringify([type,api]),{type,apiName:api});
  };
  for(const object of contents.objects)for(const field of object.fields){
   if(typeof field.relatedObject==='string'&&!internalObjects.has(field.relatedObject))
    add('object',field.relatedObject);
   if(typeof field.globalValueSetApiName==='string')
    add('global-value-set',field.globalValueSetApiName);
  }
  for(const page of contents.pages){
   if(page.pageType==='Record Page'&&typeof page.targetObject==='string'
    &&!internalObjects.has(page.targetObject))add('object',page.targetObject);
   const assignments=Array.isArray(page.activationAssignments)?page.activationAssignments as Array<Record<string,unknown>>:[];
   for(const assignment of assignments)if(typeof assignment.appId==='string')add('app',assignment.appId);
   for(const component of page.components as Array<Record<string,unknown>>)
    if(typeof component.type==='string'&&!internalComponents.has(component.type))
     add('component',component.type);
  }
  return [...values.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.apiName.localeCompare(b.apiName));
 }
 async export(tenant:string,user:string,input:unknown):Promise<MetadataPackage>{
  await this.readGrants(tenant,user);
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid package export request');
  const p=input as Record<string,unknown>;
  if(typeof p.apiName!=='string'||!apiNamePattern.test(p.apiName)
   ||typeof p.label!=='string'||!p.label.trim()||p.label.length>200
   ||!Number.isSafeInteger(p.version)||Number(p.version)<1
   ||!['Managed','Unlocked'].includes(String(p.type)))
   throw Error('Invalid package export request');
  const objectNames=parseStringList(p.objects,'objects');
  const pageNames=parseStringList(p.pages,'pages');
  const componentNames=parseStringList(p.components,'components');
  const flowNames=parseStringList(p.flows??[],'flows');
  const configurationNames=parseStringList(p.objectConfigurations??[],'objectConfigurations');
  const permissionSetNames=parseStringList(p.permissionSets??[],'permissionSets');
  if(flowNames.length)await this.rbac.require(tenant,user,'FlowDefinition','read');
  if(!objectNames.length&&!pageNames.length&&!componentNames.length&&!flowNames.length
    &&!configurationNames.length&&!permissionSetNames.length)
   throw Error('Select at least one metadata component to package');
  const current=await this.loaded(tenant,user);
  const objectMap=new Map(current.objects.filter(item=>item.kind==='Custom Object')
   .map(item=>[item.apiName,item]));
  const pageMap=new Map(current.pages.map(item=>[item.apiName,item]));
  const componentMap=new Map(current.components.map(item=>[item.apiName,item]));
  const flowMap=new Map((this.flows?await this.flows.list(tenant):[]).map(item=>
   [String(item.apiName),item as PackageFlow]));
  const rbacSnapshot=permissionSetNames.length||configurationNames.length
   ?await this.rbacAdministration?.describe(tenant,user):undefined;
  if((permissionSetNames.length||configurationNames.length)&&!rbacSnapshot)
   throw Error('RBAC metadata packaging is unavailable');
  const permissionSetMap=new Map((rbacSnapshot?.permissionSets??[]).map(item=>[item.apiName,item]));
  const missing=[...objectNames.filter(name=>!objectMap.has(name)).map(name=>'object:'+name),
   ...pageNames.filter(name=>!pageMap.has(name)).map(name=>'page:'+name),
   ...componentNames.filter(name=>!componentMap.has(name)).map(name=>'component:'+name),
   ...flowNames.filter(name=>!flowMap.has(name)).map(name=>'flow:'+name),
   ...configurationNames.filter(name=>!objectMap.has(name)).map(name=>'object-config:'+name),
   ...permissionSetNames.filter(name=>!permissionSetMap.has(name)).map(name=>'permission-set:'+name)];
  if(missing.length)throw Error('Unknown or non-packageable metadata: '+missing.join(', '));
  const contents:PackageContent={
   objects:objectNames.map(name=>{
    const object=objectMap.get(name)!;
     return {apiName:object.apiName,label:object.label,kind:object.kind,
     fields:definitionFields(object)};
   }),
   pages:pageNames.map(name=>pageProjection(pageMap.get(name)!)),
   components:componentNames.map(name=>{
    const component=componentMap.get(name)!;
    const projected=componentProjection(component) as LibraryComponent;
    return {...projected,publicationStatus:component.status==='Published'?'Published':'Draft'};
   }),
   flows:await Promise.all(flowNames.map(async name=>{
    const flow=flowMap.get(name)!;
    if(flow.status!=='Draft'&&flow.status!=='Active')
     throw Error('Unsupported Flow status for metadata packaging: '+name);
    return this.portableFlow(tenant,flow);
   })),
   objectConfigurations:await Promise.all(configurationNames.map(async name=>{
    if(!this.objectManager)throw Error('Object Manager metadata packaging is unavailable');
    const [configuration,object]=await Promise.all([
     this.objectManager.load(tenant,user,name),this.definitions.get(tenant,name)
    ]);
    const snapshot=rbacSnapshot??(this.rbacAdministration
     ?await this.rbacAdministration.describe(tenant,user):undefined);
    return portableObjectConfiguration(name,configuration,
     object as Record<string,unknown>,snapshot?.profiles??[]);
   })),
   permissionSets:permissionSetNames.map(name=>
    permissionSetProjection(permissionSetMap.get(name) as unknown as PackagePermissionSet))
  };
  const body={
   format:'metadrive-metadata-package' as const,schemaVersion:1 as const,
   package:{apiName:p.apiName,label:p.label.trim(),version:Number(p.version),
    type:p.type as 'Managed'|'Unlocked'},
   dependencies:this.dependencies(contents),contents
  };
  const json=canonicalPackage(body);
  if(Buffer.byteLength(json)>1_000_000)throw Error('Package exceeds the 1 MB portable artifact limit');
  return {...body,digest:createHash('sha256').update(json).digest('hex')};
 }
 private async dependenciesMissing(tenant:string,dependencies:Dependency[],contents:PackageContent){
  const internal=new Set<string>();
  for(const object of contents.objects)internal.add(JSON.stringify(['object',object.apiName]));
  for(const component of contents.components)internal.add(JSON.stringify(['component',component.apiName]));
  const [objects,pages,components,apps,globalValueSets]=await Promise.all([
   this.db.query<{api_name:string}>(`SELECT o.api_name FROM md_object_definitions o
    WHERE o.tenant_id=$1 AND NOT EXISTS(
     SELECT 1 FROM md_metadata_package_components c
     WHERE c.tenant_id=o.tenant_id AND c.component_type='object'
      AND c.component_api=o.api_name AND c.component_state='Retained')`,[tenant]),
   this.db.query<{api_name:string}>('SELECT api_name FROM md_page_definitions WHERE tenant_id=$1 AND enabled=true',[tenant]),
   this.db.query<{api_name:string}>('SELECT api_name FROM md_component_definitions WHERE tenant_id=$1 AND enabled=true',[tenant]),
   this.db.query<{api_name:string}>(`SELECT COALESCE(m.api_name,a.api_name) AS api_name
    FROM md_app_installations i JOIN md_apps a ON a.id=i.app_id
    LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=i.tenant_id AND m.app_id=i.app_id
    WHERE i.tenant_id=$1 AND a.enabled=true`,[tenant]),
   this.db.query<{api_name:string}>('SELECT api_name FROM md_global_value_sets WHERE tenant_id=$1',[tenant])
  ]);
  const available:Record<Dependency['type'],Set<string>>={
   object:new Set(objects.rows.map(row=>row.api_name)),
   app:new Set(apps.rows.map(row=>row.api_name)),
   component:new Set(components.rows.map(row=>row.api_name)),
   'global-value-set':new Set(globalValueSets.rows.map(row=>row.api_name))
  };
  return dependencies.filter(dependency=>!internal.has(JSON.stringify([dependency.type,dependency.apiName]))
   &&!available[dependency.type].has(dependency.apiName));
 }
 private async tracked(tenant:string,packageApi:string,
  executor:Pick<SqlPersistence,'query'>=this.db){
  const {rows}=await executor.query<{component_type:'object'|'page'|'component'|'flow'|'object-config'|'permission-set';component_api:string;
    component_state:'Active'|'Disabled'|'Retained';component_digest:string}>(`
    SELECT component_type,component_api,component_state,component_digest
    FROM md_metadata_package_components WHERE tenant_id=$1 AND package_api=$2`,
   [tenant,packageApi]);
  return rows;
 }
 async preview(tenant:string,user:string,raw:unknown):Promise<Preview>{
  await this.readGrants(tenant,user);
  const pkg=validatePackage(raw);
  if(pkg.contents.flows?.length)await this.rbac.require(tenant,user,'FlowDefinition','read');
  if(pkg.contents.flows?.length&&!this.flows)throw Error('Flow metadata packaging is unavailable');
  if(pkg.contents.objectConfigurations?.length&&!this.objectManager)
   throw Error('Object Manager metadata packaging is unavailable');
  if(pkg.contents.permissionSets?.length&&!this.rbacAdministration)
   throw Error('RBAC metadata packaging is unavailable');
  const declared=new Set(pkg.dependencies.map(item=>JSON.stringify([item.type,item.apiName])));
  if(this.dependencies(pkg.contents).some(item=>!declared.has(JSON.stringify([item.type,item.apiName]))))
   throw Error('Package manifest omits one or more required dependencies');
  const [current,missing,receipt,tracked]=await Promise.all([
   this.loaded(tenant,user),this.dependenciesMissing(tenant,pkg.dependencies,pkg.contents),
   this.db.query<{version:number;digest:string;package_type:string;active:boolean}>(
    'SELECT version,digest,package_type,active FROM md_metadata_package_installations WHERE tenant_id=$1 AND package_api=$2',
    [tenant,pkg.package.apiName]),this.tracked(tenant,pkg.package.apiName)
  ]);
  const trackedByKey=new Map(tracked.map(item=>[JSON.stringify([item.component_type,item.component_api]),item]));
  const existingObjects=new Map(current.objects.map(item=>[item.apiName,item]));
  const existingPages=new Map(current.pages.map(item=>[item.apiName,item]));
  const existingComponents=new Map(current.components.map(item=>[item.apiName,item]));
  const currentFlows=new Map((this.flows?await this.flows.list(tenant):[]).map(item=>
   [String(item.apiName),item as PackageFlow]));
  const needsRbacMetadata=Boolean(pkg.contents.permissionSets?.length||pkg.contents.objectConfigurations?.length);
  const rbacSnapshot=needsRbacMetadata&&this.rbacAdministration
   ?await this.rbacAdministration.describe(tenant,user):undefined;
  if((pkg.contents.permissionSets?.length||pkg.contents.objectConfigurations?.length)&&!rbacSnapshot)
   throw Error('RBAC metadata packaging is unavailable');
  const currentPermissionSets=new Map((rbacSnapshot?.permissionSets??[]).map(item=>[item.apiName,item]));
  const currentConfigurations=new Map<string,ObjectConfiguration>();
  for(const config of pkg.contents.objectConfigurations??[]){
   if(!this.objectManager)throw Error('Object Manager metadata packaging is unavailable');
   const [configuration,object]=await Promise.all([
    this.objectManager.load(tenant,user,config.apiName),this.definitions.get(tenant,config.apiName)
   ]);
   currentConfigurations.set(config.apiName,portableObjectConfiguration(config.apiName,configuration,
    object as Record<string,unknown>,rbacSnapshot?.profiles??[]));
  }
  const conflicts:Array<{type:string;apiName:string;reason:string}>=[];
  const preserved:Array<{type:string;apiName:string}>=[];
  const profileNames=new Set((rbacSnapshot?.profiles??[]).map(profile=>profile.apiName));
  for(const config of pkg.contents.objectConfigurations??[]){
   const layoutLabels=new Set(config.pageLayouts.map(layout=>String(
    (layout as Record<string,unknown>).label??'')));
   const recordTypeNames=new Set(config.recordTypes.map(recordType=>String(
    (recordType as Record<string,unknown>).developerName??'')));
   for(const assignment of config.pageLayoutAssignments as Array<Record<string,unknown>>){
    if(typeof assignment.profileApiName!=='string'||!profileNames.has(assignment.profileApiName))
     conflicts.push({type:'object-config',apiName:config.apiName,
      reason:'A page layout assignment references a profile missing from the destination tenant'});
    else if(typeof assignment.pageLayoutLabel!=='string'||!layoutLabels.has(assignment.pageLayoutLabel)
     ||typeof assignment.recordTypeDeveloperName!=='string'
     ||!recordTypeNames.has(assignment.recordTypeDeveloperName))
     conflicts.push({type:'object-config',apiName:config.apiName,
      reason:'A page layout assignment references a missing layout or record type'});
   }
  }
  const receiptRow=receipt.rows[0];
  let operation:Preview['operation']='install';
  if(receiptRow){
   if(receiptRow.package_type!==pkg.package.type)
    conflicts.push({type:'package',apiName:pkg.package.apiName,reason:'Package type cannot change after installation'});
   else if(pkg.package.version<receiptRow.version)
    conflicts.push({type:'package',apiName:pkg.package.apiName,reason:'Package version is older than the installed version'});
   else if(pkg.package.version===receiptRow.version&&pkg.digest!==receiptRow.digest&&receiptRow.active)
    conflicts.push({type:'package',apiName:pkg.package.apiName,reason:'A package version cannot be replaced with different content'});
   else if(!receiptRow.active)operation='reinstall';
   else if(pkg.package.version>receiptRow.version)operation='upgrade';
   else conflicts.push({type:'package',apiName:pkg.package.apiName,reason:'This package version is already installed'});
  }
  const inspect=(type:'object'|'page'|'component'|'flow'|'object-config'|'permission-set',
    api:string,existing:unknown|undefined,
    digest:(value:never)=>string)=>{
   if(!existing)return;
   const owned=trackedByKey.get(JSON.stringify([type,api]));
   if(!owned){
    conflicts.push({type,apiName:api,reason:'A component with this name already exists and is not owned by this package'});
    return;
   }
   if(owned.component_state==='Retained'&&operation!=='reinstall'){
    conflicts.push({type,apiName:api,reason:'A retained component cannot be reactivated automatically'});
    return;
   }
   if(pkg.package.type==='Unlocked'&&digest(existing as never)!==owned.component_digest)
    preserved.push({type,apiName:api});
  };
  for(const object of pkg.contents.objects)inspect('object',object.apiName,
   existingObjects.get(object.apiName),objectDigest as (value:never)=>string);
  for(const object of pkg.contents.objects){
   const existing=existingObjects.get(object.apiName);
   if(existing)for(const field of object.fields){
    const prior=existing.fields.find(item=>item.apiName===field.apiName);
    if(prior&&prior.dataType!==field.dataType)
     conflicts.push({type:'field',apiName:object.apiName+'.'+String(field.apiName),
      reason:'Field type upgrades require an explicit field migration'});
   }
  }
  for(const page of pkg.contents.pages)inspect('page',page.apiName,
   existingPages.get(page.apiName),pageDigest as (value:never)=>string);
  for(const component of pkg.contents.components)inspect('component',component.apiName,
   existingComponents.get(component.apiName),libraryDigest as (value:never)=>string);
  for(const flow of pkg.contents.flows??[])inspect('flow',flow.apiName,currentFlows.get(flow.apiName),
   (value:never)=>digestOf(flowProjection(value as unknown as PackageFlow)));
  for(const config of pkg.contents.objectConfigurations??[])inspect('object-config',config.apiName,
   currentConfigurations.get(config.apiName),objectConfigurationDigest as (value:never)=>string);
  for(const set of pkg.contents.permissionSets??[])inspect('permission-set',set.apiName,
   currentPermissionSets.get(set.apiName) as PackagePermissionSet|undefined,
   (value:never)=>digestOf(permissionSetProjection(value as unknown as PackagePermissionSet)));
  const available=new Set([...current.objects.map(item=>item.apiName),...pkg.contents.objects.map(item=>item.apiName)]);
  for(const object of pkg.contents.objects)for(const field of object.fields)
   if(typeof field.relatedObject==='string'&&!available.has(field.relatedObject)
     &&!missing.some(item=>item.type==='object'&&item.apiName===field.relatedObject))
    missing.push({type:'object',apiName:field.relatedObject});
  for(const config of pkg.contents.objectConfigurations??[])
   if(!available.has(config.apiName))missing.push({type:'object',apiName:config.apiName});
  return {canInstall:missing.length===0&&conflicts.length===0,operation,
   missingDependencies:missing,conflicts,preservedCustomizations:preserved};
 }
 private async writeGrant(tenant:string,user:string,resource:string,
  action:'create'|'manage'|'read'){
  await this.rbac.require(tenant,user,resource,action);
 }
 async install(tenant:string,user:string,raw:unknown){
  const pkg=validatePackage(raw);
  const preview=await this.preview(tenant,user,pkg);
  if(!preview.canInstall)throw Error('Package cannot be installed: '+JSON.stringify({
   missingDependencies:preview.missingDependencies,conflicts:preview.conflicts
  }));
  const current=await this.loaded(tenant,user);
  const currentFlows=new Map((this.flows?await this.flows.list(tenant):[]).map(item=>
   [String(item.apiName),item as PackageFlow]));
  const objectNames=new Set(current.objects.map(item=>item.apiName));
  const pageNames=new Set(current.pages.map(item=>item.apiName));
  const componentNames=new Set(current.components.map(item=>item.apiName));
  for(const object of pkg.contents.objects)if(!objectNames.has(object.apiName)){
   await this.writeGrant(tenant,user,'ObjectDefinition','create');
   if(object.fields.length)await this.writeGrant(tenant,user,'FieldDefinition','create');
  }else{
   if(pkg.package.type==='Managed')await this.writeGrant(tenant,user,'ObjectDefinition','manage');
   if(object.fields.length)await this.writeGrant(tenant,user,'FieldDefinition','create');
  }
  for(const page of pkg.contents.pages)await this.writeGrant(tenant,user,'PageDefinition',
   pageNames.has(page.apiName)?'manage':'create');
  for(const component of pkg.contents.components)await this.writeGrant(tenant,user,'ComponentDefinition',
   componentNames.has(component.apiName)?'manage':'create');
  for(const config of pkg.contents.objectConfigurations??[]){
   if(!this.objectManager)throw Error('Object Manager metadata packaging is unavailable');
   await this.writeGrant(tenant,user,'ObjectDefinition','manage');
   await this.rbac.require(tenant,user,config.apiName,'edit');
  }
  if(pkg.contents.flows?.length){
   if(!this.flows)throw Error('Flow metadata packaging is unavailable');
   await this.writeGrant(tenant,user,'FlowDefinition','manage');
  }
  if(pkg.contents.permissionSets?.length){
   if(!this.rbacAdministration)throw Error('RBAC metadata packaging is unavailable');
   await this.writeGrant(tenant,user,'Security','manage');
   await this.writeGrant(tenant,user,'Security','read');
  }
  return this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenant+':metadata-package:'+pkg.package.apiName]);
   const scoped=packageScopedPersistence(client);
   const packageRbac=new (await import('../system-files/rbac-engine.js')).RbacEngine(scoped);
   const definitions=new (await import('../system-files/object-definition.js')).ObjectDefinitionService(scoped);
   const pages=new (await import('../system-files/page-runtime.js')).PageRuntime(scoped);
   const library=new (await import('./component-library-service.js')).ComponentLibraryService(scoped,packageRbac);
   const objectManager=this.objectManager
    ?new (await import('../system-files/object-manager-metadata.js')).ObjectManagerMetadataService(scoped,packageRbac)
    :undefined;
   const flowRuntime=this.flows
    ?new (await import('../system-files/flow-runtime.js')).FlowRuntime(scoped,packageRbac)
    :undefined;
   const existingReceipt=await client.query<{version:number;digest:string;package_type:string;active:boolean}>(`
    SELECT version,digest,package_type,active FROM md_metadata_package_installations
    WHERE tenant_id=$1 AND package_api=$2 FOR UPDATE`,[tenant,pkg.package.apiName]);
   const installed=existingReceipt.rows[0];
   if(installed&&(installed.package_type!==pkg.package.type||pkg.package.version<installed.version
     ||installed.active&&pkg.package.version===installed.version&&installed.digest!==pkg.digest))
    throw Error('Package installation changed while applying the update');
   const previous=await this.tracked(tenant,pkg.package.apiName,client);
   const previousKeys=new Set(previous.map(item=>JSON.stringify([item.component_type,item.component_api])));
   const currentObjects=await definitions.list(tenant) as MetadataObject[];
   const objectMap=new Map(currentObjects.map(item=>[item.apiName,item]));
   const oldObjectNames=new Set(previous.filter(item=>item.component_type==='object').map(item=>item.component_api));
   const preservedObjects=new Set(preview.preservedCustomizations
    .filter(item=>item.type==='object').map(item=>item.apiName));
   for(const object of pkg.contents.objects){
    if(preservedObjects.has(object.apiName))continue;
    const existing=objectMap.get(object.apiName);
    if(!existing)await definitions.create(tenant,object.apiName,object.label,[]);
    else if(!oldObjectNames.has(object.apiName))
     throw Error('Package object is not owned by this package: '+object.apiName);
   }
   const refreshedObjects=await definitions.list(tenant) as MetadataObject[];
   const refreshedMap=new Map(refreshedObjects.map(item=>[item.apiName,item]));
   for(const object of pkg.contents.objects){
    if(preservedObjects.has(object.apiName))continue;
    if(pkg.package.type==='Managed'&&oldObjectNames.has(object.apiName)){
     await client.query(`UPDATE md_object_definitions SET label=$3
      WHERE tenant_id=$1 AND api_name=$2 AND is_system=false`,
      [tenant,object.apiName,object.label]);
     for(const field of definitionFields(object)){
      const hasField=refreshedMap.get(object.apiName)?.fields.some(item=>item.apiName===field.apiName);
      if(hasField)await definitions.updateField(tenant,object.apiName,String(field.apiName),field,user);
     }
    }
    const exists=new Set((refreshedMap.get(object.apiName)?.fields??[]).map(field=>String(field.apiName)));
    const pending=definitionFields(object).filter(field=>!exists.has(String(field.apiName)));
    for(const field of definitionFields(object))if(exists.has(String(field.apiName))){
     const currentField=refreshedMap.get(object.apiName)?.fields.find(item=>item.apiName===field.apiName);
     if(currentField&&currentField.dataType!==field.dataType)
      throw Error('Package field type changes require an explicit field migration: '+object.apiName+'.'+String(field.apiName));
    }
    let remaining=[...pending];
    while(remaining.length){
     const ready=remaining.filter(field=>typeof field.controllerFieldApiName!=='string'
      ||exists.has(field.controllerFieldApiName));
     if(!ready.length)throw Error('Package field dependency cycle: '+object.apiName);
     for(const field of ready){
      await definitions.addField(tenant,object.apiName,String(field.apiName),String(field.dataType),
       typeof field.relatedObject==='string'?field.relatedObject:undefined,
       typeof field.label==='string'?field.label:undefined,field);
      exists.add(String(field.apiName));
     }
     const added=new Set(ready);
     remaining=remaining.filter(field=>!added.has(field));
    }
   }
   for(const config of pkg.contents.objectConfigurations??[]){
     if(preview.preservedCustomizations.some(item=>item.type==='object-config'&&item.apiName===config.apiName))
      continue;
     if(!objectManager)throw Error('Object Manager metadata packaging is unavailable');
     await objectManager.persistWithin(client,tenant,config.apiName,config.configuration);
     const currentObject=await definitions.get(tenant,config.apiName) as Record<string,unknown>;
     const currentRevision=Number(currentObject.revision??0);
     const existingLayouts=Array.isArray(currentObject.pageLayouts)
      ?currentObject.pageLayouts as Array<Record<string,unknown>>:[];
     const existingRecordTypes=Array.isArray(currentObject.recordTypes)
      ?currentObject.recordTypes as Array<Record<string,unknown>>:[];
     const layoutIdByLabel=new Map(existingLayouts.map(layout=>[String(layout.label),String(layout.id)]));
     const recordTypeIdByName=new Map(existingRecordTypes.map(type=>
      [String(type.developerName),String(type.id)]));
     const layouts:Array<Record<string,unknown>>=(config.pageLayouts as Array<Record<string,unknown>>).map(layout=>({
      ...layout,id:layoutIdByLabel.get(String(layout.label))??randomUUID(),
      sections:(layout.sections as Array<Record<string,unknown>>).map(section=>({...section,id:randomUUID()})),
      customLinks:(layout.customLinks as Array<Record<string,unknown>>).map(link=>({...link,id:randomUUID()}))
     }));
     const recordTypes:Array<Record<string,unknown>>=(config.recordTypes as Array<Record<string,unknown>>).map(recordType=>({
      ...recordType,id:recordTypeIdByName.get(String(recordType.developerName))??randomUUID()
     }));
     const layoutByLabel=new Map(layouts.map(layout=>[String(layout.label),String(layout.id)]));
     const recordTypeByName=new Map(recordTypes.map(type=>[String(type.developerName),String(type.id)]));
     const snapshot=this.rbacAdministration
      ?await this.rbacAdministration.describe(tenant,user):undefined;
     const profileByApi=new Map((snapshot?.profiles??[]).map(profile=>[profile.apiName,profile.id]));
     const assignments=(config.pageLayoutAssignments as Array<Record<string,unknown>>).flatMap(assignment=>{
      const profileId=profileByApi.get(String(assignment.profileApiName));
      const recordTypeId=recordTypeByName.get(String(assignment.recordTypeDeveloperName));
      const pageLayoutId=layoutByLabel.get(String(assignment.pageLayoutLabel));
      return profileId&&recordTypeId&&pageLayoutId?[{profileId,recordTypeId,pageLayoutId}]:[];
     });
     if(assignments.length!==config.pageLayoutAssignments.length)
      throw Error('Object configuration contains an unresolved page layout assignment: '+config.apiName);
     if(layouts.length)await definitions.replaceLayouts(tenant,config.apiName,{
      pageLayouts:layouts,pageLayoutAssignments:assignments,recordTypes
     },currentRevision,user);
    }
    for(const flow of pkg.contents.flows??[]){
     if(preview.preservedCustomizations.some(item=>item.type==='flow'&&item.apiName===flow.apiName))continue;
     if(!flowRuntime)throw Error('Flow metadata packaging is unavailable');
     const old=previous.some(item=>item.component_type==='flow'&&item.component_api===flow.apiName);
     const existingFlow=old?await flowRuntime.loadEditor(tenant,flow.apiName):undefined;
     if(!old&&currentFlows.has(flow.apiName))
      throw Error('Package Flow is not owned by this package: '+flow.apiName);
     const localized=await this.localizeFlow(tenant,flow);
     await flowRuntime.saveEditor(tenant,user,flow.apiName,{
      ...localized,apiName:flow.apiName,status:'Draft',
      ...(existingFlow?{versionNumber:existingFlow.versionNumber}:{}),
     });
    }
    if(pkg.contents.permissionSets?.length){
     if(!this.rbacAdministration)throw Error('RBAC metadata packaging is unavailable');
     const state=await this.rbacAdministration.describe(tenant,user);
     const permissionSets=[...state.permissionSets];
     for(const incoming of pkg.contents.permissionSets){
      const index=permissionSets.findIndex(item=>item.apiName===incoming.apiName);
      const currentSet=index>=0?permissionSets[index]:undefined;
      if(currentSet&&!previous.some(item=>item.component_type==='permission-set'
        &&item.component_api===incoming.apiName))
       throw Error('Package permission set is not owned by this package: '+incoming.apiName);
      const next={...(currentSet??{}),...incoming,id:currentSet?.id??randomUUID()};
      if(index>=0)permissionSets[index]=next as typeof permissionSets[number];
      else permissionSets.push(next as typeof permissionSets[number]);
     }
     const packageAdmin=new (await import('./rbac-administration.js')).RbacAdministration(scoped,packageRbac);
     await packageAdmin.saveWithin(client,tenant,user,{...state,permissionSets});
   }
   const oldPageNames=new Set(previous.filter(item=>item.component_type==='page').map(item=>item.component_api));
   const currentPages=await pages.list(tenant) as MetadataPage[];
   const pageMap=new Map(currentPages.map(item=>[item.apiName,item]));
   for(const page of pkg.contents.pages){
    const existing=pageMap.get(page.apiName);
    if(existing&&!oldPageNames.has(page.apiName))throw Error('Package page is not owned by this package: '+page.apiName);
    if(existing&&preview.preservedCustomizations.some(item=>item.type==='page'&&item.apiName===page.apiName))continue;
    await pages.save(tenant,page.apiName,{...page,revision:existing?.revision});
   }
   const oldComponentNames=new Set(previous.filter(item=>item.component_type==='component').map(item=>item.component_api));
   for(const component of pkg.contents.components){
    const exists=componentNames.has(component.apiName)||oldComponentNames.has(component.apiName);
    if(exists&&!oldComponentNames.has(component.apiName))throw Error('Package component is not owned by this package: '+component.apiName);
    if(preview.preservedCustomizations.some(item=>item.type==='component'&&item.apiName===component.apiName))continue;
    if(previous.some(item=>item.component_type==='component'&&item.component_api===component.apiName
      &&item.component_state==='Disabled'))
     await client.query(`UPDATE md_component_definitions SET enabled=true
      WHERE tenant_id=$1 AND api_name=$2 AND renderer_key='tenant-library'`,
      [tenant,component.apiName]);
    const {version:_version,status:_status,publishedVersion:_publishedVersion,
     updatedAt:_updatedAt,compiledJs:_compiledJs,scopedCss:_scopedCss,...input}=component;
    await library.save(tenant,user,{...input,
     publicationStatus:component.publicationStatus??(component.status==='Published'?'Published':'Draft')},
     exists?component.apiName:undefined);
   }
   const newKeys=new Set([
    ...pkg.contents.objects.map(item=>JSON.stringify(['object',item.apiName])),
    ...pkg.contents.pages.map(item=>JSON.stringify(['page',item.apiName])),
    ...pkg.contents.components.map(item=>JSON.stringify(['component',item.apiName])),
    ...(pkg.contents.flows??[]).map(item=>JSON.stringify(['flow',item.apiName])),
    ...(pkg.contents.objectConfigurations??[]).map(item=>JSON.stringify(['object-config',item.apiName])),
    ...(pkg.contents.permissionSets??[]).map(item=>JSON.stringify(['permission-set',item.apiName]))
   ]);
   for(const item of previous)if(item.component_state==='Active'
     &&!newKeys.has(JSON.stringify([item.component_type,item.component_api]))){
    if(item.component_type==='object'){
     await client.query(`UPDATE md_metadata_package_components SET component_state='Retained'
      WHERE tenant_id=$1 AND package_api=$2 AND component_type='object' AND component_api=$3`,
      [tenant,pkg.package.apiName,item.component_api]);
    }else if(item.component_type==='page'){
     const page=pageMap.get(item.component_api);
     if(page)await pages.save(tenant,item.component_api,{...page,status:'Draft',revision:page.revision});
     await client.query(`UPDATE md_metadata_package_components SET component_state='Disabled'
      WHERE tenant_id=$1 AND package_api=$2 AND component_type='page' AND component_api=$3`,
      [tenant,pkg.package.apiName,item.component_api]);
    }else if(item.component_type==='flow'){
     if(flowRuntime){
      const definition=await flowRuntime.loadEditor(tenant,item.component_api).catch(error=>{
       if(error instanceof Error&&error.message==='Flow not found')return undefined;
       throw error;
      });
      if(definition?.status==='Active')
       await flowRuntime.deactivate(tenant,user,item.component_api);
     }
     await client.query(`UPDATE md_metadata_package_components SET component_state='Retained'
      WHERE tenant_id=$1 AND package_api=$2 AND component_type='flow' AND component_api=$3`,
      [tenant,pkg.package.apiName,item.component_api]);
    }else if(item.component_type==='object-config'||item.component_type==='permission-set'){
     await client.query(`UPDATE md_metadata_package_components SET component_state='Retained'
      WHERE tenant_id=$1 AND package_api=$2 AND component_type=$3 AND component_api=$4`,
      [tenant,pkg.package.apiName,item.component_type,item.component_api]);
    }else{
     const references=currentPages.some(page=>!oldPageNames.has(page.apiName)
      &&(page.components as Array<Record<string,unknown>>).some(node=>node.type===item.component_api));
     if(references)await client.query(`UPDATE md_metadata_package_components SET component_state='Retained'
      WHERE tenant_id=$1 AND package_api=$2 AND component_type='component' AND component_api=$3`,
      [tenant,pkg.package.apiName,item.component_api]);
     else{
      await library.remove(tenant,user,item.component_api);
      await client.query(`UPDATE md_metadata_package_components SET component_state='Disabled'
       WHERE tenant_id=$1 AND package_api=$2 AND component_type='component' AND component_api=$3`,
       [tenant,pkg.package.apiName,item.component_api]);
     }
    }
   }
   await client.query(`INSERT INTO md_metadata_package_installations
    (tenant_id,package_api,label,package_type,version,digest,active,installed_by)
    VALUES($1,$2,$3,$4,$5,$6,true,$7)
    ON CONFLICT(tenant_id,package_api) DO UPDATE SET label=EXCLUDED.label,
     version=EXCLUDED.version,digest=EXCLUDED.digest,active=true,installed_by=EXCLUDED.installed_by,updated_at=now()`,
    [tenant,pkg.package.apiName,pkg.package.label,pkg.package.type,pkg.package.version,pkg.digest,user]);
   await client.query(`INSERT INTO md_metadata_package_versions(tenant_id,package_api,version,digest,installed_by)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,package_api,version) DO NOTHING`,
    [tenant,pkg.package.apiName,pkg.package.version,pkg.digest,user]);
   for(const [type,api,digest] of [
    ...pkg.contents.objects.map(item=>['object',item.apiName,objectDigest(item)]),
    ...pkg.contents.pages.map(item=>['page',item.apiName,pageDigest(item)]),
     ...pkg.contents.components.map(item=>['component',item.apiName,libraryDigest(item)]),
     ...(pkg.contents.flows??[]).map(item=>['flow',item.apiName,digestOf(flowProjection(item))]),
     ...(pkg.contents.objectConfigurations??[]).map(item=>['object-config',item.apiName,
      objectConfigurationDigest(item)]),
     ...(pkg.contents.permissionSets??[]).map(item=>['permission-set',item.apiName,
      digestOf(permissionSetProjection(item))])
    ] as Array<['object'|'page'|'component'|'flow'|'object-config'|'permission-set',string,string]>){
    if(previousKeys.has(JSON.stringify([type,api]))){
     await client.query(`UPDATE md_metadata_package_components SET component_state='Active',component_digest=$5
      WHERE tenant_id=$1 AND package_api=$2 AND component_type=$3 AND component_api=$4`,
      [tenant,pkg.package.apiName,type,api,digest]);
    }else await client.query(`INSERT INTO md_metadata_package_components
      (tenant_id,package_api,component_type,component_api,component_digest)
      VALUES($1,$2,$3,$4,$5)`,[tenant,pkg.package.apiName,type,api,digest]);
   }
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,$2,'metadata-package.installed',$3::jsonb)`,[tenant,user,JSON.stringify({
     packageApi:pkg.package.apiName,version:pkg.package.version,type:pkg.package.type,digest:pkg.digest
    })]);
   return {package:pkg.package,operation:preview.operation,preservedCustomizations:preview.preservedCustomizations};
  });
 }
 async uninstall(tenant:string,user:string,packageApi:string){
  await this.readGrants(tenant,user);
  if(!apiNamePattern.test(packageApi))throw Error('Invalid package name');
  return this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenant+':metadata-package:'+packageApi]);
   const receipt=await client.query<{active:boolean;version:number}>(`
    SELECT active,version FROM md_metadata_package_installations
    WHERE tenant_id=$1 AND package_api=$2 FOR UPDATE`,[tenant,packageApi]);
   if(!receipt.rows[0]||!receipt.rows[0].active)throw Error('Package is not installed');
   const scoped=packageScopedPersistence(client);
   const packageRbac=new (await import('../system-files/rbac-engine.js')).RbacEngine(scoped);
   const tracked=await this.tracked(tenant,packageApi,client);
   if(!tracked.length)throw Error('Package is not installed');
   if(tracked.some(item=>item.component_type==='object'&&item.component_state==='Active'))
    await packageRbac.require(tenant,user,'ObjectDefinition','manage');
   if(tracked.some(item=>item.component_type==='page'&&item.component_state==='Active'))
    await packageRbac.require(tenant,user,'PageDefinition','manage');
   if(tracked.some(item=>item.component_type==='component'&&item.component_state==='Active'))
    await packageRbac.require(tenant,user,'ComponentDefinition','manage');
   if(tracked.some(item=>item.component_type==='flow'&&item.component_state==='Active'))
    await packageRbac.require(tenant,user,'FlowDefinition','manage');
   if(tracked.some(item=>item.component_type==='object-config'&&item.component_state==='Active'))
    await packageRbac.require(tenant,user,'ObjectDefinition','manage');
   if(tracked.some(item=>item.component_type==='permission-set'&&item.component_state==='Active')){
    await packageRbac.require(tenant,user,'Security','manage');
    await packageRbac.require(tenant,user,'Security','read');
   }
   const pages=new (await import('../system-files/page-runtime.js')).PageRuntime(scoped);
   const library=new (await import('./component-library-service.js')).ComponentLibraryService(scoped,packageRbac);
   const flowRuntime=new (await import('../system-files/flow-runtime.js')).FlowRuntime(scoped,packageRbac);
   const installedPages=new Set(tracked.filter(item=>item.component_type==='page'
    &&item.component_state==='Active').map(item=>item.component_api));
   const currentPages=await pages.list(tenant) as MetadataPage[];
   for(const page of currentPages)if(installedPages.has(page.apiName))
    await pages.save(tenant,page.apiName,{...page,status:'Draft',revision:page.revision});
   for(const item of tracked.filter(item=>item.component_type==='flow'&&item.component_state==='Active')){
    const flow=await flowRuntime.loadEditor(tenant,item.component_api);
    if(flow.status==='Active')await flowRuntime.deactivate(tenant,user,item.component_api);
   }
   const retainedComponents:string[]=[];
   const disabledComponents:string[]=[];
   for(const item of tracked.filter(item=>item.component_type==='component'&&item.component_state==='Active')){
    const usedOutsidePackage=currentPages.some(page=>!installedPages.has(page.apiName)
     &&(page.components as Array<Record<string,unknown>>).some(node=>node.type===item.component_api));
    if(usedOutsidePackage)retainedComponents.push(item.component_api);
    else{
     await library.remove(tenant,user,item.component_api);
     disabledComponents.push(item.component_api);
    }
   }
   const retainedObjects=tracked.filter(item=>item.component_type==='object'
    &&item.component_state!=='Disabled').map(item=>item.component_api);
   const retainedFlows=tracked.filter(item=>item.component_type==='flow'
    &&item.component_state!=='Disabled').map(item=>item.component_api);
   const retainedObjectConfigurations=tracked.filter(item=>item.component_type==='object-config'
    &&item.component_state!=='Disabled').map(item=>item.component_api);
   const retainedPermissionSets=tracked.filter(item=>item.component_type==='permission-set'
    &&item.component_state!=='Disabled').map(item=>item.component_api);
   await client.query(`UPDATE md_metadata_package_installations SET active=false,updated_at=now()
    WHERE tenant_id=$1 AND package_api=$2`,[tenant,packageApi]);
   await client.query(`UPDATE md_metadata_package_components SET component_state=CASE
     WHEN component_type IN ('object','flow','object-config','permission-set')
       OR (component_type='component' AND component_api=ANY($3::text[])) THEN 'Retained'
     ELSE 'Disabled' END
    WHERE tenant_id=$1 AND package_api=$2 AND component_state='Active'`,
    [tenant,packageApi,retainedComponents]);
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,$2,'metadata-package.uninstalled',$3::jsonb)`,
    [tenant,user,JSON.stringify({packageApi,version:receipt.rows[0].version,
      retainedObjects,retainedFlows,retainedObjectConfigurations,retainedPermissionSets,
      retainedComponents,disabledComponents})]);
   return {packageApi,retainedObjects,retainedFlows,retainedObjectConfigurations,
    retainedPermissionSets,retainedComponents,disabledPages:[...installedPages],disabledComponents};
  });
 }
 async list(tenant:string,user:string){
  await this.readGrants(tenant,user);
  const {rows}=await this.db.query<{package_api:string;label:string;package_type:'Managed'|'Unlocked';
    version:number;digest:string;active:boolean;updated_at:Date}>(`
    SELECT package_api,label,package_type,version,digest,active,updated_at
    FROM md_metadata_package_installations WHERE tenant_id=$1 ORDER BY label,package_api`,[tenant]);
  return rows.map(row=>({
   apiName:row.package_api,label:row.label,type:row.package_type,version:row.version,
   digest:row.digest,active:row.active,updatedAt:row.updated_at.toISOString()
  }));
 }
}

const handler=(fn:(req:AuthenticatedRequest,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{
  void fn(req as AuthenticatedRequest,res).catch(next);
 };
export function registerMetadataPackageRoutes(app:Express,service:MetadataPackageService){
 app.post('/api/metadata/packages/export',handler(async(req,res)=>{
  const actor=req.actor!;
  const metadataPackage=await service.export(actor.tenant_id,actor.user_id,req.body);
  res.setHeader('Cache-Control','private, no-store');
  res.json({metadataPackage});
 }));
 app.post('/api/metadata/packages/preview',handler(async(req,res)=>{
  const actor=req.actor!;
  res.setHeader('Cache-Control','private, no-store');
  res.json({preview:await service.preview(actor.tenant_id,actor.user_id,req.body?.metadataPackage)});
 }));
 app.post('/api/metadata/packages/install',handler(async(req,res)=>{
  const actor=req.actor!;
  res.status(201).json(await service.install(actor.tenant_id,actor.user_id,req.body?.metadataPackage));
 }));
 app.get('/api/metadata/packages',handler(async(req,res)=>{
  const actor=req.actor!;
  res.setHeader('Cache-Control','private, no-store');
  res.json({packages:await service.list(actor.tenant_id,actor.user_id)});
 }));
 app.post('/api/metadata/packages/:apiName/uninstall',handler(async(req,res)=>{
  const actor=req.actor!;
  res.json(await service.uninstall(actor.tenant_id,actor.user_id,req.params.apiName));
 }));
}

export async function assertMetadataPackageEditable(db:SqlPersistence,tenant:string,
 type:'object'|'page'|'component'|'flow'|'object-config'|'permission-set',apiName:string){
 const {rows}=await db.query<{locked:boolean}>(`
  SELECT EXISTS(SELECT 1 FROM md_metadata_package_components c
   JOIN md_metadata_package_installations p ON p.tenant_id=c.tenant_id AND p.package_api=c.package_api
   WHERE c.tenant_id=$1 AND c.component_type=$2 AND c.component_api=$3
    AND c.component_state='Active' AND p.active=true AND p.package_type='Managed') AS locked`,
 [tenant,type,apiName]);
 if(rows[0]?.locked)throw Error('Managed package metadata is read-only: '+apiName);
}
