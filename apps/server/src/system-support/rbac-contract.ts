import {z} from 'zod';
import {toPermissionRule,systemPermissionBindings,toDisplayedPermission} from './permission-resource-map.js';
export const id=z.string().uuid(),api=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
const text=z.string().max(4000),label=z.string().trim().min(1).max(120);
const ids=z.array(id).max(2000).refine(a=>new Set(a).size===a.length,'Duplicate membership');
const flags=z.record(z.boolean()),matrix=z.record(flags);
const rule=z.object({resource:z.string().min(1).max(200),action:z.string().min(1).max(80),effect:z.enum(['allow','deny'])}).strict();
const grants={
 systemPermissions:z.array(z.string().max(200)).max(3000),
 objectPermissions:matrix,fieldPermissions:matrix,recordTypePermissions:flags.default({}),
 appPermissions:flags.default({}),tabPermissions:flags.default({}),
 deniedPermissions:z.array(z.string().max(250)).default([]),advancedRules:z.array(rule).max(3000).default([])
};
const base={id,apiName:api,label,description:text.default('')};
export const policySet=z.object({...base,...grants,license:text.default(''),
 navigationDefaultAccess:z.enum(['Allow','Deny']).default('Deny'),
 recordDataScopes:z.record(z.enum(['all','descendants','own'])).default({})}).strict();
const profile=z.object({...base,...grants,license:text.default('MetaDrive'),isStandard:z.boolean().default(false),
 inheritedPermissionSetIds:ids.default([])}).strict();
const group=z.object({...base,permissionSetIds:ids,calculationStatus:z.enum(['Updated','Updating','Failed']),
 lastCalculatedAt:z.string().nullable(),mutedSystemPermissions:z.array(z.string()).max(3000),
 mutedObjectPermissions:matrix,mutedFieldPermissions:matrix,mutedRecordTypePermissions:flags,
 mutedAppPermissions:flags.default({}),mutedTabPermissions:flags.default({})}).strict();
const publicGroup=z.object({...base,userIds:ids,roleIds:ids,roleAndSubordinateIds:ids,groupIds:ids}).strict();
const queue=z.object({...base,userIds:ids,roleIds:ids,roleAndSubordinateIds:ids,publicGroupIds:ids,
 supportedObjectApiNames:z.array(api).max(500)}).strict();
const condition=z.object({field:z.string().min(1).max(128),
 operator:z.enum(['eq','ne','in','notIn','isNull','notNull']),
 value:z.union([text,z.array(text).max(500),z.number().finite(),z.boolean(),z.null()]).optional()}).strict();
const restriction=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),tenantId:id,objectApiName:api,enabled:z.boolean(),
 subjectType:z.enum(['all','user','role','external']),subjectId:id.optional(),
 conditionLogic:z.enum(['all','any']),conditions:z.array(condition).min(1).max(16)}).strict();
const setting=z.object({defaultAccess:z.enum(['Private','Public Read Only','Public Read/Write']),
 grantAccessUsingHierarchies:z.boolean(),restrictionRules:z.array(restriction).max(100).default([]),
 portalEnabled:z.boolean().default(false),portalAccountField:z.string().max(128).optional()}).strict();
const share=z.object({id,label,apiName:api,objectApiName:api,active:z.boolean(),
 type:z.enum(['OwnerBased','CriteriaBased']),ownerRoleIds:ids,
 criteria:z.array(z.object({fieldApiName:z.string().min(1).max(128),
 operator:z.enum(['Equals','Not Equals','Contains','Starts With','Greater Than','Less Than','Is Null']),value:text}).strict()).max(16),
 filterLogic:z.enum(['All','Any']),targetType:z.enum(['User','PublicGroup','Role','RoleAndSubordinates']),
 targetId:id,accessLevel:z.enum(['Read','Edit'])}).strict();
export const snapshot=z.object({
 tenantId:id,revision:z.number().int().nonnegative(),
 profiles:z.array(profile).max(500),permissionSets:z.array(policySet).max(500),permissionSetGroups:z.array(group).max(500),
 roles:z.array(z.object({id,apiName:api,name:label,parentRoleId:id.nullable()}).strict()).max(500),
 users:z.array(z.object({id,name:text,username:text,role:text,roleId:z.union([id,z.literal('')]),
  profileId:z.union([id,z.literal('')]),permissionSetIds:ids,permissionSetGroupIds:ids,
  timeZone:z.string().max(100),locale:z.string().max(80),currencyIsoCode:z.string().regex(/^[A-Z]{3}$/).optional(),
  userType:z.enum(['internal','external']).default('internal'),externalAccountId:id.optional()}).strict()).max(2000),
 publicGroups:z.array(publicGroup).max(500),queues:z.array(queue).max(500),
 sharingRules:z.array(share).max(1000),sharingSettings:z.record(setting)
}).strict();
export type Snapshot=z.infer<typeof snapshot>;
export type PolicySet=z.infer<typeof policySet>;
export type Rule=z.infer<typeof rule>;
export const objectActions=['read','create','edit','delete','viewAll','modifyAll'];
export const fieldActions=['read','edit','create','delete'];
export function grantRules(set:Pick<PolicySet,keyof typeof grants>):Rule[]{
 const rules=new Map<string,Rule>();
 const put=(resource:string,action:string,effect:'allow'|'deny')=>{
  if(!/^[A-Za-z0-9_*][A-Za-z0-9_.*:-]*$/.test(resource)||!/^([A-Za-z][A-Za-z0-9_-]*|\*)$/.test(action))
   throw Error('Invalid permission rule');
  const key=resource+':'+action;
  if(rules.get(key)?.effect==='deny'&&effect==='allow')return;
  rules.set(key,{resource,action,effect});
 };
 const wildcard=set.systemPermissions.includes('*:*');
 if(wildcard)put('*','*','allow');
 for(const token of set.systemPermissions){
  if(token==='*:*')continue;
  const r=toPermissionRule(token);put(r.resource,r.action,'allow');
 }
 if(wildcard)for(const token of Object.keys(systemPermissionBindings)){
  if(!set.systemPermissions.includes(token)){const r=toPermissionRule(token);put(r.resource,r.action,'deny');}
 }
 for(const [resource,actions] of Object.entries(set.objectPermissions)){
  api.parse(resource);
  for(const [action,on] of Object.entries(actions)){
   if(!objectActions.includes(action))throw Error('Invalid object permission');
   if(on||wildcard)put(resource,action,on?'allow':'deny');
  }
 }
 for(const [resource,actions] of Object.entries(set.fieldPermissions)){
  if(resource.split('.').length!==2)throw Error('Invalid field permission');
  resource.split('.').forEach(part=>api.parse(part));
  for(const [action,on] of Object.entries(actions)){
   if(!fieldActions.includes(action))throw Error('Invalid field permission');
   if(on||wildcard)put(resource,action,on?'allow':'deny');
  }
 }
 for(const [prefix,items] of [['RecordType:',set.recordTypePermissions],['App:',set.appPermissions],['Tab:',set.tabPermissions]] as const)
  for(const [name,on] of Object.entries(items))if(on||wildcard)put(prefix+name,'read',on?'allow':'deny');
 for(const token of set.deniedPermissions){
  const r=toPermissionRule(token);
  // Restoring a visible grant removes its previous explicit denial.
  const shown=rules.get(r.resource+':'+r.action);
  if(shown?.effect!=='allow')put(r.resource,r.action,'deny');
 }
 for(const r of set.advancedRules)put(r.resource,r.action,r.effect);
 if(rules.size>10000)throw Error('Too many permissions');
 return [...rules.values()];
}
export function displayRules(rules:Rule[],objects:string[],fields:string[],types:string[],apps:string[]){
 const wildcard=rules.some(r=>r.resource==='*'&&r.action==='*'&&r.effect==='allow');
 const data={systemPermissions:[] as string[],objectPermissions:{} as Record<string,Record<string,boolean>>,
  fieldPermissions:{} as Record<string,Record<string,boolean>>,recordTypePermissions:{} as Record<string,boolean>,
  appPermissions:{} as Record<string,boolean>,tabPermissions:{} as Record<string,boolean>,deniedPermissions:[] as string[],advancedRules:[] as Rule[]};
 const allowed=(resource:string,action:string)=>!rules.some(r=>r.effect==='deny'&&
  (r.resource===resource||r.resource==='*')&&(r.action===action||r.action==='*'))&&
  (wildcard||rules.some(r=>r.effect==='allow'&&r.resource===resource&&(r.action===action||r.action==='*')));
 if(wildcard)data.systemPermissions.push('*:*');
 for(const token of Object.keys(systemPermissionBindings)){
  const r=toPermissionRule(token);if(allowed(r.resource,r.action))data.systemPermissions.push(token);
 }
 for(const name of objects){data.objectPermissions[name]=Object.fromEntries(objectActions.map(a=>[a,allowed(name,a)]));data.tabPermissions[name]=allowed('Tab:'+name,'read');}
 for(const name of fields)data.fieldPermissions[name]=Object.fromEntries(fieldActions.map(a=>[a,allowed(name,a)]));
 for(const name of types)data.recordTypePermissions[name]=allowed('RecordType:'+name,'read');
 for(const name of apps)data.appPermissions[name]=allowed('App:'+name,'read');
 for(const r of rules){
  if((r.resource.includes('*')||r.action==='*')&&!(r.resource==='*'&&r.action==='*'&&r.effect==='allow')){data.advancedRules.push(r);continue;}
  if(r.effect==='deny')data.deniedPermissions.push(toDisplayedPermission(r.resource,r.action));
  if(r.resource==='*'||objects.includes(r.resource)||fields.includes(r.resource))continue;
  if(r.resource.startsWith('RecordType:'))data.recordTypePermissions[r.resource.slice(11)]=allowed(r.resource,r.action);
  else if(r.resource.startsWith('App:'))data.appPermissions[r.resource.slice(4)]=allowed(r.resource,r.action);
  else if(r.resource.startsWith('Tab:'))data.tabPermissions[r.resource.slice(4)]=allowed(r.resource,r.action);
  else if(r.effect==='allow'){
   const token=toDisplayedPermission(r.resource,r.action);
   if(!data.systemPermissions.includes(token))data.systemPermissions.push(token);
  }
 }
 return data;
}
