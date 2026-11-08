import {resolveDefaultValues} from './DefaultValueResolver.js';
import type {PoolClient} from 'pg';
import {evaluateResolvedFormulaSql} from '../system-support/formula-sql-runtime.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {
  createFormulaEvaluationContext,evaluateFlowFormula,flowFormulaReferences,validateFlowFormula,
  type FormulaEvaluationContext
} from '../system-files/flow-formula-runtime.js';

type Values=Record<string,unknown>;
type Rule={api_name:string;expression:string;error_message:string;error_field_api:string|null};
export type RecordLifecycleContext={
  stage:'create'|'update'|'clone';
  isClone?:boolean;
  recordTypeId?:string|null;
  now?:Date|string;
};
const api=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const userGlobals=new Set(['Id','Name','Email','TimeZone','Locale','CurrencyIsoCode']);
const profileGlobals=new Set(['Id','Name','DeveloperName']);
const organizationGlobals=new Set(['Id','Name']);
const recordTypeGlobals=new Set(['Id','Name','DeveloperName']);
export class DeclarativeRuleError extends Error {
  readonly ruleApi:string;
  readonly fieldApi:string|null;
  constructor(rule:Rule) {
    super(rule.error_message);
    this.name='DeclarativeRuleError';
    this.ruleApi=rule.api_name;
    this.fieldApi=rule.error_field_api;
  }
}
/** Shared, server-enforced rule evaluation. No eval(), separate expression language or app logic. */
export class DeclarativeRules {
  constructor(private readonly rbac:RbacEngine){}
  async context(client:PoolClient,tenantId:string,userId:string,objectApi:string,
    current:Values,prior:Values|null,expression:string,lifecycle?:RecordLifecycleContext) {
    validateFlowFormula(expression,'validation_rule');
    const references=flowFormulaReferences(expression);
    const [{rows:actors},{rows:tenants}]=await Promise.all([
      client.query<{id:string;email:string;display_name:string;time_zone:string;locale:string;
        currency_iso_code:string|null;profile_id:string|null;profile_name:string|null;profile_api:string|null}>(
      `SELECT u.id,u.email,u.display_name,u.time_zone,u.locale,u.currency_iso_code,
        p.id AS profile_id,p.label AS profile_name,p.api_name AS profile_api
       FROM md_users u LEFT JOIN md_user_profiles up ON up.tenant_id=u.tenant_id AND up.user_id=u.id
       LEFT JOIN md_profiles p ON p.tenant_id=up.tenant_id AND p.id=up.profile_id
       WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true LIMIT 1`,[tenantId,userId]),
      client.query<{id:string;name:string}>('SELECT id,name FROM md_tenants WHERE id=$1',[tenantId])
    ]);
    const actor=actors[0];
    if(!actor)throw new Error('Rule execution actor is unavailable');
    const organization=tenants[0];
    if(!organization)throw new Error('Rule execution organization is unavailable');
    const recordTypeId=lifecycle?.recordTypeId
      ??(typeof current.RecordTypeId==='string'?current.RecordTypeId:null);
    let recordType:FormulaEvaluationContext['recordType']={Id:null,Name:null,DeveloperName:null};
    if(recordTypeId){
      const {rows}=await client.query<{record_type_id:string;label:string;developer_name:string}>(
        `SELECT record_type_id,label,developer_name FROM md_object_record_types
         WHERE tenant_id=$1 AND object_api=$2 AND record_type_id=$3 AND active=true`,
        [tenantId,objectApi,recordTypeId]);
      if(!rows[0])throw new Error('Rule record type is unavailable');
      await this.rbac.require(tenantId,userId,'RecordType:'+objectApi+'.'+recordTypeId,'read');
      recordType={Id:rows[0].record_type_id,Name:rows[0].label,
        DeveloperName:rows[0].developer_name};
    }
    const fields:Record<string,boolean>=Object.create(null) as Record<string,boolean>;
    const permissions:Record<string,boolean>=Object.create(null) as Record<string,boolean>;
    for(const reference of references){
      let field:string|null=null;
      if(reference.startsWith('$Record.'))field=reference.slice(8);
      else if(reference.startsWith('$Record__Prior.'))field=reference.slice(15);
      else if(reference.startsWith(objectApi+'.'))field=reference.slice(objectApi.length+1);
      else if(api.test(reference)&&Object.hasOwn(current,reference))field=reference;
      else if(reference.startsWith('$Permission.')){
        const name=reference.slice('$Permission.'.length);
        if(!api.test(name))throw new Error('Invalid custom permission reference');
        permissions[name]=await this.rbac.allowed(
          tenantId,userId,'CustomPermission:'+name,'read');
      }else if(reference.startsWith('$User.')
        &&!userGlobals.has(reference.slice(6))){
        throw new Error('Unsupported rule global reference: '+reference);
      }else if(reference.startsWith('$Profile.')
        &&!profileGlobals.has(reference.slice(9))){
        throw new Error('Unsupported rule global reference: '+reference);
      }else if(reference.startsWith('$Organization.')
        &&!organizationGlobals.has(reference.slice(14))){
        throw new Error('Unsupported rule global reference: '+reference);
      }else if(reference.startsWith('$RecordType.')
        &&!recordTypeGlobals.has(reference.slice(12))){
        throw new Error('Unsupported rule global reference: '+reference);
      }else if(reference.startsWith('$')&&!reference.startsWith('$User.')
        &&!reference.startsWith('$Profile.')&&!reference.startsWith('$Organization.')
        &&!reference.startsWith('$RecordType.')
        &&!['$Record','$Record__Prior'].includes(reference))
        throw new Error('Unsupported rule global reference: '+reference);
      if(field){
        if(!api.test(field))throw new Error('Invalid rule field reference');
        await this.rbac.require(tenantId,userId,objectApi+'.'+field,'read');
        fields[field]=true;
      }
    }
    const evaluation=createFormulaEvaluationContext({
      timeZone:actor.time_zone,locale:actor.locale,currencyIsoCode:actor.currency_iso_code,
      now:lifecycle?.now??new Date(),isClone:lifecycle?.isClone===true,
      transactionStage:lifecycle?.stage,currentRecord:current,priorRecord:prior,
      actor:{Id:actor.id,Name:actor.display_name,Email:actor.email,TimeZone:actor.time_zone,
        Locale:actor.locale,CurrencyIsoCode:actor.currency_iso_code},
      profile:{Id:actor.profile_id,Name:actor.profile_name,DeveloperName:actor.profile_api},
      organization:{Id:organization.id,Name:organization.name},recordType,
      permissionSnapshot:permissions,fieldAccess:fields
    });
    const resolve=(name:string):unknown=>{
      if(name==='$Record')return evaluation.currentRecord;
      if(name==='$Record__Prior')return evaluation.priorRecord;
      if(name==='$User')return evaluation.actor;
      if(name==='$Profile')return evaluation.profile;
      if(name==='$Organization')return evaluation.organization;
      if(name==='$RecordType')return evaluation.recordType;
      if(name.startsWith('$Record.'))return evaluation.currentRecord?.[name.slice(8)]??null;
      if(name.startsWith('$Record__Prior.'))return evaluation.priorRecord?.[name.slice(15)]??null;
      if(name.startsWith(objectApi+'.'))return evaluation.currentRecord?.[name.slice(objectApi.length+1)]??null;
      if(name.startsWith('$User.'))return resolvePath(evaluation.actor,name.slice(6));
      if(name.startsWith('$Profile.'))return resolvePath(evaluation.profile,name.slice(9));
      if(name.startsWith('$Organization.'))return resolvePath(evaluation.organization,name.slice(14));
      if(name.startsWith('$RecordType.'))return resolvePath(evaluation.recordType,name.slice(12));
      if(name.startsWith('$Permission.'))return evaluation.permissionSnapshot?.[name.slice(12)]===true;
      return evaluation.currentRecord?.[name]??null;
    };
    return {resolve,evaluation};
  }
  async defaults(client:PoolClient,tenantId:string,userId:string,objectApi:string,values:Values,
    literals:Values={},lifecycle?:RecordLifecycleContext) {
    return resolveDefaultValues(client,tenantId,userId,objectApi,values,literals,
      async(expression,current,now)=>{
        const ctx=await this.context(client,tenantId,userId,objectApi,current,null,expression,
          {...(lifecycle??{stage:'create'}),now});
        const timeZone=ctx.evaluation.timeZone;
        if(!timeZone)throw new Error('Rule execution time zone is unavailable');
        return {...ctx,timeZone};
      },lifecycle?.now);
  }
  async validate(client:PoolClient,tenantId:string,userId:string,objectApi:string,
    current:Values|(()=>Promise<Values>),prior:Values|null|(()=>Promise<Values|null>),
    lifecycle:RecordLifecycleContext={stage:'update'}) {
    const {rows}=await client.query<Rule>(
      `SELECT api_name,expression,error_message,error_field_api FROM md_validation_rules
       WHERE tenant_id=$1 AND object_api=$2 AND active=true ORDER BY sort_order,api_name`,
      [tenantId,objectApi]);
    if(!rows.length)return;
    const currentValues=typeof current==='function'?await current():current;
    const priorValues=typeof prior==='function'?await prior():prior;
    const now=lifecycle.now??new Date();
    for(const rule of rows){
      const ctx=await this.context(client,tenantId,userId,objectApi,currentValues,priorValues,
        rule.expression,{...lifecycle,now});
      const invalid=await evaluateResolvedFormulaSql(client,rule.expression,ctx.resolve,ctx.evaluation,'validation_rule');
      if(typeof invalid!=='boolean')throw new Error('Validation rule must return Checkbox: '+rule.api_name);
      if(invalid)throw new DeclarativeRuleError(rule);
    }
  }
}

function resolvePath(source:object|null|undefined,path:string):unknown {
  if(!source)return null;
  const descriptor=Object.getOwnPropertyDescriptor(source,path);
  return descriptor&&Object.prototype.hasOwnProperty.call(descriptor,'value')
    ?descriptor.value??null:null;
}
