import {validateAndMatchRecord} from '../business-rule-engine/RuleExecutionCoordinator.js';
import {requiresUniqueValue} from '../business-rule-engine/UniqueConstraintManager.js';
import {registeredRelationships} from '../relationship-engine/RelationshipRegistry.js';
import {resolveRelationshipFieldPath} from '../relationship-engine/RelationshipPathResolver.js';
import {assertDeletionAllowed,shouldCascadeReference} from '../relationship-engine/ReferentialIntegrityGuard.js';
import {assertLookupTargetExists} from '../relationship-engine/LookupResolver.js';
import {enforceMasterDetailReparenting} from '../relationship-engine/MasterDetailManager.js';
import {rollupParents,refreshRollups} from '../relationship-engine/RollupAggregationManager.js';
import {readRollupSummaryField} from '../field-engine/types/RollupSummaryField.js';
import {validateLookupField} from '../field-engine/types/LookupField.js';
import {compareLookupFilter,type LookupFilterMetadata} from './object-manager-lookup-filters.js';
import {normalizeNumberField} from '../field-engine/types/NumberField.js';
import {normalizeCheckboxField} from '../field-engine/types/CheckboxField.js';
import {validateTextField} from '../field-engine/types/TextField.js';
import {validatePicklistField} from '../field-engine/types/PicklistField.js';
import {validateMultiSelectPicklistField} from '../field-engine/types/MultiSelectPicklistField.js';
import {validatePhoneField} from '../field-engine/types/PhoneField.js';
import {validateEmailField} from '../field-engine/types/EmailField.js';
import {validateUrlField} from '../field-engine/types/UrlField.js';
import {validateImageAssetField,validateFileAssetField} from '../field-engine/types/ImageAssetField.js';
import {normalizeTimeField} from '../field-engine/types/TimeField.js';
import {normalizeDateField} from '../field-engine/types/DateField.js';
import {normalizeDateTimeField} from '../field-engine/types/DateTimeField.js';
import type {SqlPersistence} from './sql-persistence.js';
import type {PoolClient} from 'pg';
import type {RbacEngine} from './rbac-engine.js';
import {formatAutoNumberValue} from './auto-number-format.js';
import {DeclarativeRules} from './declarative-rules.js';
import {RecordMatching} from './record-matching.js';
import {evaluateFlowFormula,flowFormulaReferences,isFormulaImageResult,validateFlowFormula,
  createFormulaEvaluationContext,
  type FormulaEvaluationContext} from './flow-formula-runtime.js';
import {decryptFieldValue,encryptFieldValue,maskEncryptedFieldValue} from './encrypted-field.js';
import {evaluateResolvedFormulaSql} from '../system-support/formula-sql-runtime.js';
import {sanitizeRichText} from './rich-text.js';
import {compileRecordFilters,type QueryField,type RecordCursor,type RecordFilter} from '../object-engine/QueryBuilder.js';
import {computeFilteredNumericAggregate} from '../object-engine/FilteredNumericAggregate.js';
type FieldDefinition={api_name:string;data_type:string;related_object:string|null;relationship_type:string|null;allow_reparenting:boolean;required:boolean;max_length:number|null;precision:number|null;scale:number|null;is_unique:boolean;external_id:boolean;case_sensitive:boolean;default_value:string|null;auto_number_format:string|null;rollup_child_object?:string|null;rollup_relationship_field?:string|null;rollup_operation?:string|null;rollup_source_field?:string|null;rollup_source_data_type?:string|null;formula_expression?:string|null;formula_return_type?:string|null;picklist_restricted?:boolean;controller_field_api_name?:string|null;global_value_set_api?:string|null};
type EncryptedValueVault={
  encryptOpaque(value:string):{ciphertext:Buffer;keyId:string};
  decryptOpaque(ciphertext:Buffer,keyId:string):string;
};
type Storable={value_text:string|null;reference_record_id:string|null;value_number?:string|null;value_date?:string|null;value_datetime?:Date|null;value_boolean?:boolean|null;geo_latitude?:number|null;geo_longitude?:number|null;address_street?:string|null;address_city?:string|null;address_state?:string|null;address_postal_code?:string|null;address_country?:string|null;multi_values?:string[];is_unique:boolean;case_sensitive:boolean};
type RecordTriggerHandler=(
  client:PoolClient,tenantId:string,userId:string,objectApi:string,
  operation:'created'|'updated'|'deleted',
  record:Record<string,unknown>|null,prior:Record<string,unknown>|null,
  phase?:'before-save'|'after-save',isClone?:boolean
)=>Promise<Record<string,unknown>|void>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const api=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const contextValue=(source:object|null|undefined,key:string):unknown=>{
  if(!source)return null;
  const descriptor=Object.getOwnPropertyDescriptor(source,key);
  return descriptor&&Object.prototype.hasOwnProperty.call(descriptor,'value')
    ?descriptor.value??null:null;
};

/** One list read: formula fields share the user/tenant context and field-access checks across rows. */
type FormulaBatch={shared?:Promise<{rows:unknown[];tenants:Array<{id:string;name:string}>;
  currencyRates:Record<string,number>;actor:{id:string;email:string;display_name:string;time_zone:string;locale:string;
  user_currency_iso_code:string|null;profile_id:string|null;profile_name:string|null;profile_api:string|null};
  fields:Record<string,boolean>;permissions:Record<string,boolean>}>;visible:Map<string,boolean>};
export class RecordEngine {
  private recordTrigger?:RecordTriggerHandler;
  private get declarativeRules(){return new DeclarativeRules(this.rbac);}
  private get recordMatching(){return new RecordMatching(this.rbac);}
  private richTextFilePruner?:(
    client:PoolClient,tenantId:string,objectApi:string,recordId:string,fieldApi:string,html:string|null
  )=>Promise<void>;
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
    private readonly encryptedValueVault?:EncryptedValueVault) {}
  private async lockObjectForWrite(client:PoolClient,tenantId:string,objectApi:string) {
    const active=await client.query(`SELECT 1 FROM md_matching_rules
      WHERE tenant_id=$1 AND object_api=$2 AND active=true LIMIT 1`,[tenantId,objectApi]);
    // Rules that prevent duplicates need serial writes. Other objects retain shared
    // metadata-migration locks to avoid regressing generic CRUD concurrency.
    await client.query(active.rowCount
      ?'SELECT pg_advisory_xact_lock(hashtextextended($1,0))'
      :'SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',
      [`${tenantId}:${objectApi}`]);
    if(!active.rowCount){
      const now=await client.query(`SELECT 1 FROM md_matching_rules
        WHERE tenant_id=$1 AND object_api=$2 AND active=true LIMIT 1`,[tenantId,objectApi]);
      // A rule was activated while the writer awaited its shared lock.
      // Retry with an exclusive lock rather than admitting concurrent duplicates.
      if(now.rowCount)throw new Error('Matching rule configuration changed; retry record save');
    }
  }
  setRecordTriggerHandler(handler:RecordTriggerHandler) {
    this.recordTrigger=handler;
  }
  setRichTextFilePruner(handler:NonNullable<RecordEngine['richTextFilePruner']>) {
    this.richTextFilePruner=handler;
  }
  private async fields(tenantId:string,objectApi:string,client?:PoolClient):Promise<FieldDefinition[]> {
    const executor=client??this.db;
    const {rows}=await executor.query<FieldDefinition&{package_object_retained?:boolean}>(
      `SELECT api_name,data_type,related_object,relationship_type,allow_reparenting,required,max_length,precision,scale,is_unique,external_id,
       formula_expression,formula_return_type,g.value_set_api AS global_value_set_api,
       EXISTS(SELECT 1 FROM md_metadata_package_components c
         WHERE c.tenant_id=md_field_definitions.tenant_id AND c.component_type='object'
          AND c.component_api=md_field_definitions.object_api AND c.component_state='Retained')
         AS package_object_retained,
        case_sensitive,default_value,auto_number_format,picklist_restricted,
        rollup_child_object,rollup_relationship_field,rollup_operation,rollup_source_field,
        (SELECT s.data_type FROM md_field_definitions s
         WHERE s.tenant_id=md_field_definitions.tenant_id
           AND s.object_api=md_field_definitions.rollup_child_object
           AND s.api_name=md_field_definitions.rollup_source_field AND s.deleted_at IS NULL)
          AS rollup_source_data_type,
        (SELECT d.controller_field_api FROM md_field_dependencies d
         WHERE d.tenant_id=md_field_definitions.tenant_id AND d.object_api=md_field_definitions.object_api
           AND d.field_api=md_field_definitions.api_name) AS controller_field_api_name
       FROM md_field_definitions LEFT JOIN md_field_global_value_sets g
         ON g.tenant_id=md_field_definitions.tenant_id AND g.object_api=md_field_definitions.object_api
          AND g.field_api=md_field_definitions.api_name
       WHERE md_field_definitions.tenant_id=$1 AND md_field_definitions.object_api=$2
         AND md_field_definitions.deleted_at IS NULL`,
      [tenantId,objectApi]);
    if(rows[0]?.package_object_retained)
      throw Error('Metadata package component is uninstalled: '+objectApi);
    if(!rows.length){
      const retained=await executor.query<{retained:boolean}>(`SELECT EXISTS(
        SELECT 1 FROM md_metadata_package_components
        WHERE tenant_id=$1 AND component_type='object' AND component_api=$2
          AND component_state='Retained') AS retained`,[tenantId,objectApi]);
      if(retained.rows[0]?.retained)
        throw Error('Metadata package component is uninstalled: '+objectApi);
    }
    return rows;
  }
  private async formulaContext(tenantId:string,userId:string,objectApi:string,
    record:Record<string,unknown>,definitions:readonly FieldDefinition[],
    client?:PoolClient,now:Date|string=new Date(),batch?:FormulaBatch):Promise<FormulaEvaluationContext>{
    const executor=client??this.db;
    const formulas=definitions.filter(field=>field.data_type==='formula'
      &&typeof field.formula_expression==='string');
    const references=[...new Set(formulas.flatMap(field=>
      flowFormulaReferences(field.formula_expression!)))];
    // The user, tenant and field-access part does not depend on the row: a list read loads it once.
    const loadShared=async()=>{
    const [{rows},{rows:tenants}]=await Promise.all([
      executor.query<{
      id:string;email:string;display_name:string;time_zone:string;locale:string;
      user_currency_iso_code:string|null;profile_id:string|null;profile_name:string|null;
      profile_api:string|null;has_currency_settings:boolean;
      currency_iso_code:string|null;conversion_rate:string|null
    }>(`SELECT u.id,u.email,u.display_name,u.time_zone,u.locale,
        u.currency_iso_code AS user_currency_iso_code,p.id AS profile_id,
        p.label AS profile_name,p.api_name AS profile_api,
        (s.tenant_id IS NOT NULL) AS has_currency_settings,
        currency.value->>'currencyIsoCode' AS currency_iso_code,
        currency.value->>'conversionRate' AS conversion_rate
      FROM md_users u
      LEFT JOIN md_user_profiles up ON up.tenant_id=u.tenant_id AND up.user_id=u.id
      LEFT JOIN md_profiles p ON p.tenant_id=up.tenant_id AND p.id=up.profile_id
      LEFT JOIN md_tenant_settings s ON s.tenant_id=u.tenant_id AND s.setting_key='currencies'
      LEFT JOIN LATERAL jsonb_array_elements(
        COALESCE(s.properties->'currencies','{"currencies":[]}'::jsonb)->'currencies'
      ) currency(value) ON true
      WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true`,
      [tenantId,userId]),
      references.some(reference=>reference.startsWith('$Organization.'))
        ?executor.query<{id:string;name:string}>('SELECT id,name FROM md_tenants WHERE id=$1',[tenantId])
        :Promise.resolve({rows:[] as Array<{id:string;name:string}>})
    ]);
    if(!rows.length)throw new Error('Formula evaluation user is unavailable in this tenant');
    const currencyRates:Record<string,number>={};
    if(!rows[0].has_currency_settings)currencyRates.USD=1;
    for(const row of rows){
      if(row.currency_iso_code&&row.conversion_rate!==null){
        const rate=Number(row.conversion_rate);
        if(!/^[A-Z]{3}$/.test(row.currency_iso_code)||!Number.isFinite(rate)||rate<=0)
          throw new Error('Invalid tenant currency rate configuration');
        currencyRates[row.currency_iso_code]=rate;
      }
    }
    const actor=rows[0];
    const fields:Record<string,boolean>=Object.create(null) as Record<string,boolean>;
    const permissions:Record<string,boolean>=Object.create(null) as Record<string,boolean>;
    for(const reference of references){
      let field:string|null=null;
      if(reference.startsWith('$Record.'))field=reference.slice(8);
      else if(reference.startsWith(objectApi+'.'))field=reference.slice(objectApi.length+1);
      else if(api.test(reference)&&definitions.some(item=>item.api_name===reference))field=reference;
      else if(reference.startsWith('$Permission.')){
        const name=reference.slice('$Permission.'.length);
        if(!api.test(name))throw new Error('Invalid formula custom permission reference');
        permissions[name]=await this.rbac.allowed(
          tenantId,userId,'CustomPermission:'+name,'read');
      }else if(reference.startsWith('$')&&!reference.startsWith('$User.')
        &&!reference.startsWith('$Profile.')&&!reference.startsWith('$Organization.')
        &&!reference.startsWith('$RecordType.')&&reference!=='$Record')
        throw new Error('Unsupported formula global reference: '+reference);
      if(field){
        if(!api.test(field))throw new Error('Invalid formula field reference');
        fields[field]=await this.rbac.allowed(tenantId,userId,objectApi+'.'+field,'read');
      }
    }
    return {rows,tenants,currencyRates,actor,fields,permissions};
    };
    const {tenants,currencyRates,actor,fields,permissions}=
      await (batch?(batch.shared??=loadShared()):loadShared());
    let organization:FormulaEvaluationContext['organization'];
    if(references.some(reference=>reference.startsWith('$Organization.'))){
      if(!tenants[0])throw new Error('Formula organization context is unavailable');
      organization={Id:tenants[0].id,Name:tenants[0].name};
    }
    let recordType:FormulaEvaluationContext['recordType'];
    if(references.some(reference=>reference.startsWith('$RecordType.'))){
      const recordTypeId=typeof record.RecordTypeId==='string'?record.RecordTypeId:null;
      if(!recordTypeId)recordType={Id:null,Name:null,DeveloperName:null};
      else{
        const {rows:types}=await executor.query<{record_type_id:string;label:string;
          developer_name:string}>(`SELECT record_type_id,label,developer_name
          FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2
            AND record_type_id=$3 AND active=true`,[tenantId,objectApi,recordTypeId]);
        if(!types[0])throw new Error('Formula record type is unavailable');
        await this.rbac.require(tenantId,userId,'RecordType:'+objectApi+'.'+recordTypeId,'read');
        recordType={Id:types[0].record_type_id,Name:types[0].label,
          DeveloperName:types[0].developer_name};
      }
    }
    return createFormulaEvaluationContext({
      timeZone:actor.time_zone,locale:actor.locale,
      currencyIsoCode:actor.user_currency_iso_code,currencyRates,now,
      transactionStage:'formula-field',isClone:record.__isClone===true,
      currentRecord:record,
      actor:{Id:actor.id,Name:actor.display_name,Email:actor.email,TimeZone:actor.time_zone,
        Locale:actor.locale,CurrencyIsoCode:actor.user_currency_iso_code},
      profile:{Id:actor.profile_id,Name:actor.profile_name,DeveloperName:actor.profile_api},
      ...(organization?{organization}:{}),...(recordType?{recordType}:{}),
      permissionSnapshot:permissions,fieldAccess:fields
    });
  }
  private async picklistValues(tenantId:string,objectApi:string,fieldApi:string,client?:PoolClient) {
    const {rows}=await (client??this.db).query<{value:string}>(`
      SELECT p.value FROM md_field_picklist_values p
      WHERE p.tenant_id=$1 AND p.object_api=$2 AND p.field_api=$3
        AND NOT EXISTS(SELECT 1 FROM md_field_global_value_sets g
          WHERE g.tenant_id=p.tenant_id AND g.object_api=p.object_api AND g.field_api=p.field_api)
      UNION
      SELECT v.value FROM md_field_global_value_sets g
      JOIN md_global_value_sets s ON s.tenant_id=g.tenant_id AND s.api_name=g.value_set_api
      JOIN md_global_value_set_values v ON v.tenant_id=s.tenant_id AND v.value_set_id=s.id
      WHERE g.tenant_id=$1 AND g.object_api=$2 AND g.field_api=$3 AND v.active
      ORDER BY value`,[tenantId,objectApi,fieldApi]);
    return rows.map(row=>row.value);
  }
  private async outputFieldValue(tenantId:string,userId:string,objectApi:string,fieldApi:string,
    recordId:string,value:string|null) {
    if(value===null)return null;
    const reveal=await this.rbac.allowed(tenantId,userId,'ViewEncryptedData','read');
    if(!reveal)return maskEncryptedFieldValue();
    if(!this.encryptedValueVault)throw new Error('Encrypted field vault is unavailable');
    const plaintext=decryptFieldValue(this.encryptedValueVault,tenantId,objectApi,fieldApi,value);
    await this.db.query(`INSERT INTO md_encrypted_field_access_audit
      (tenant_id,record_id,object_api,field_api,accessed_by)
      VALUES($1,$2,$3,$4,$5)`,[tenantId,recordId,objectApi,fieldApi,userId]);
    return plaintext;
  }
  // Legacy engine surface retained for system tests and trusted callers.
  private async rollupParents(client:PoolClient,tenantId:string,childObject:string,recordId:string){
    return rollupParents(client,tenantId,childObject,recordId);
  }
  private async refreshRollups(client:PoolClient,tenantId:string,childObject:string,
    parentIds:Map<string,Set<string>>,visited=new Set<string>(),depth=0){
    return refreshRollups(client,tenantId,childObject,parentIds,visited,depth);
  }
  private async applyFormulaFields(tenantId:string,userId:string,objectApi:string,
    record:Record<string,unknown>,definitions:readonly FieldDefinition[],client?:PoolClient,
    migrationMode=false,formulaContext:FormulaEvaluationContext={},batch?:FormulaBatch) {
    const formulas=new Map(definitions.filter(field=>field.data_type==='formula'
      &&typeof field.formula_expression==='string').map(field=>[field.api_name,field]));
    const calculated=new Map<string,unknown>();
    const calculating=new Set<string>();
    const referenceCache=new Map<string,unknown>();
    const visible=batch?.visible??new Map<string,boolean>();
    const canRead=async(targetObject:string,fieldApi:string)=>{
      if(migrationMode)return true;
      const key=targetObject+'.'+fieldApi;
      if(!visible.has(key))visible.set(key,await this.rbac.allowed(tenantId,userId,key,'read'));
      return visible.get(key)===true;
    };
    const fetchCrossReference=async(targetObject:string,fieldApi:string)=>{
      const key=targetObject+'.'+fieldApi;
      if(referenceCache.has(key))return;
      const relationship=definitions.find(field=>field.data_type==='reference'
        &&field.related_object===targetObject);
      const recordId=relationship?record[relationship.api_name]:undefined;
      if(!relationship||typeof recordId!=='string'
        ||!await canRead(objectApi,relationship.api_name)||!await canRead(targetObject,fieldApi)){
        referenceCache.set(key,null);return;
      }
      const result=await (client??this.db).query<{
        value_text:string|null;reference_record_id:string|null;data_type:string|null;
        value_date:string|null;value_datetime:Date|string|null;rollup_source_data_type:string|null;
      }>(`SELECT v.value_text,v.reference_record_id,f.data_type,v.value_date::text AS value_date,
          v.value_datetime,
          (SELECT source.data_type FROM md_field_definitions summary
           JOIN md_field_definitions source ON source.tenant_id=summary.tenant_id
             AND source.object_api=summary.rollup_child_object
             AND source.api_name=summary.rollup_source_field AND source.deleted_at IS NULL
           WHERE summary.tenant_id=f.tenant_id AND summary.object_api=f.object_api
             AND summary.api_name=f.api_name AND summary.data_type='rollup') AS rollup_source_data_type
        FROM md_records r
        LEFT JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id
          AND v.object_api=r.object_api AND v.field_api=$4
        LEFT JOIN md_field_definitions f ON f.tenant_id=v.tenant_id AND f.object_api=v.object_api
          AND f.api_name=v.field_api AND f.deleted_at IS NULL
        WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.id=$3 AND r.is_deleted=false
          AND ${migrationMode?'true':"md_record_access($1,$5,r.id,'read')"}`,
      migrationMode?[tenantId,targetObject,recordId,fieldApi]:
        [tenantId,targetObject,recordId,fieldApi,userId]);
      const row=result.rows[0];
      const value=!row||row.data_type==='encryptedtext'?null:
        row.data_type==='rollup'&&row.rollup_source_data_type==='date'?row.value_date:
        row.data_type==='rollup'&&row.rollup_source_data_type==='datetime'?
          row.value_datetime===null?null:new Date(row.value_datetime).toISOString():
        row.reference_record_id??row.value_text;
      referenceCache.set(key,value===null?null:
        ['number','currency','percent'].includes(String(row?.data_type))?Number(value):
          row?.data_type==='boolean'?value==='true':value);
    };
    const calculate=async(field:FieldDefinition):Promise<unknown>=>{
      if(calculated.has(field.api_name))return calculated.get(field.api_name);
      if(calculating.has(field.api_name))throw new Error('Cyclic formula dependency: '+field.api_name);
      calculating.add(field.api_name);
      for(const reference of flowFormulaReferences(field.formula_expression!)){
        if(reference==='$Record')continue;
        const globalField=(prefix:string)=>reference.startsWith(prefix)
          ?reference.slice(prefix.length):null;
        const userField=globalField('$User.');
        if(userField!==null){
          if(!['Id','Name','Email','TimeZone','Locale','CurrencyIsoCode'].includes(userField))
            throw new Error('Unsupported formula global reference: '+reference);
          continue;
        }
        const profileField=globalField('$Profile.');
        if(profileField!==null){
          if(!['Id','Name','DeveloperName'].includes(profileField))
            throw new Error('Unsupported formula global reference: '+reference);
          continue;
        }
        const organizationField=globalField('$Organization.');
        if(organizationField!==null){
          if(!['Id','Name'].includes(organizationField))
            throw new Error('Unsupported formula global reference: '+reference);
          continue;
        }
        const recordTypeField=globalField('$RecordType.');
        if(recordTypeField!==null){
          if(!['Id','Name','DeveloperName'].includes(recordTypeField))
            throw new Error('Unsupported formula global reference: '+reference);
          continue;
        }
        if(reference.startsWith('$Permission.'))continue;
        if(reference.startsWith('$Record__Prior'))
          throw new Error('$Record__Prior is unavailable in formula fields');
        if(reference.startsWith('$')&&!reference.startsWith('$Record.'))
          throw new Error('Unsupported formula global reference: '+reference);
        // Related-field aliases and multi-hop paths use the canonical metadata
        // graph. Legacy Object.Field remains valid when exactly one lookup
        // points to that object; ambiguous lookups must be named explicitly.
        const segments=(reference.startsWith('$Record.')?reference.slice(8):reference).split('.');
        const steps=segments[0]===objectApi||segments[0]==='Record'
          ?segments.slice(1):segments;
        const sameTarget=steps.length===2?definitions.filter(item=>
          item.data_type==='reference'&&item.related_object===steps[0]).length:0;
        if(steps.length>=2&&(steps.length>2||sameTarget!==1)){
          const resolved=await resolveRelationshipFieldPath(client??this.db,tenantId,userId,
            objectApi,record,steps,migrationMode);
          referenceCache.set(reference,resolved);
          continue;
        }
        const [referenceObject,referenceField]=reference.split('.');
        const targetObject=reference.startsWith('$Record.')?objectApi:
          referenceField?referenceObject:objectApi;
        const fieldApi=reference.startsWith('$Record.')?reference.slice(8):
          referenceField??reference;
        if(!api.test(fieldApi))throw new Error('Invalid formula field reference');
        if(targetObject==='Record'&&!referenceField)continue;
        const resolvedObject=targetObject==='Record'?objectApi:targetObject;
        if(resolvedObject===objectApi){
          if(!await canRead(objectApi,fieldApi)){calculating.delete(field.api_name);return null;}
          const dependency=formulas.get(fieldApi);
          if(dependency)await calculate(dependency);
        }
        if(resolvedObject!==objectApi){
          const relationship=definitions.find(item=>item.data_type==='reference'&&item.related_object===resolvedObject);
          if(!relationship||!await canRead(objectApi,relationship.api_name)
            ||!await canRead(resolvedObject,fieldApi)){
            calculating.delete(field.api_name);return null;
          }
          await fetchCrossReference(resolvedObject,fieldApi);
        }
      }
      validateFlowFormula(field.formula_expression!,'formula_field');
      const result=await evaluateResolvedFormulaSql(client??this.db,field.formula_expression!,name=>{
        if(name==='$Record')return formulaContext.currentRecord;
        if(name.startsWith('$Record.'))
          return referenceCache.has(name)?referenceCache.get(name):
            formulaContext.currentRecord?.[name.slice(8)]??null;
        if(name.startsWith('$User.'))return contextValue(formulaContext.actor,name.slice(6));
        if(name.startsWith('$Profile.'))return contextValue(formulaContext.profile,name.slice(9));
        if(name.startsWith('$Organization.'))
          return contextValue(formulaContext.organization,name.slice(14));
        if(name.startsWith('$RecordType.'))
          return contextValue(formulaContext.recordType,name.slice(12));
        if(name.startsWith('$Permission.'))
          return formulaContext.permissionSnapshot?.[name.slice(12)]===true;
        if(name.startsWith('$'))throw new Error('Unsupported formula global reference: '+name);
        if(referenceCache.has(name))return referenceCache.get(name);
        const parts=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(name);
        if(!parts)return record[name]??null;
        if(parts[1]===objectApi||parts[1]==='Record')
          return calculated.has(parts[2])?calculated.get(parts[2]):record[parts[2]]??null;
        return referenceCache.get(parts[1]+'.'+parts[2])??null;
      },{...formulaContext,isClone:record.__isClone===true},'formula_field');
      calculating.delete(field.api_name);
      calculated.set(field.api_name,result);
      return result;
    };
    for(const field of formulas.values()){
      if(!await canRead(objectApi,field.api_name))continue;
      const value=await calculate(field);
      const returnType=field.formula_return_type?.toLowerCase();
      if(['number','currency','percent'].includes(String(returnType))){
        const number=Number(value);
        if(value!==null&&!Number.isFinite(number))throw new Error('Formula did not return a finite number: '+field.api_name);
        record[field.api_name]=value===null?null:number;
      }else if(returnType==='checkbox'){
        if(value!==null&&typeof value!=='boolean')throw new Error('Formula did not return a checkbox value: '+field.api_name);
        record[field.api_name]=value;
      }else if(returnType==='date'){
        const date=value===null?null:String(value);
        if(date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(date))
          throw new Error('Formula did not return a date value: '+field.api_name);
        record[field.api_name]=date;
      }else if(returnType==='datetime'){
        const dateTime=value===null?null:String(value);
        const timestamp=dateTime===null?null:Date.parse(dateTime);
        if(timestamp!==null&&!Number.isFinite(timestamp))
          throw new Error('Formula did not return a date/time value: '+field.api_name);
        record[field.api_name]=timestamp===null?null:new Date(timestamp).toISOString();
      }else if(returnType==='time'){
        const time=value===null?null:String(value);
        const match=time===null?null:/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(time);
        if(time!==null&&!match)throw new Error('Formula did not return a time value: '+field.api_name);
        record[field.api_name]=match
          ?`${match[1]}:${match[2]}:${match[3]??'00'}.${(match[4]??'').padEnd(3,'0')}`
          :null;
      }else record[field.api_name]=value===null?null:
        isFormulaImageResult(value)?value:String(value);
    }
  }
  async evaluateFormulaForMigration(client:PoolClient,tenantId:string,userId:string,
    objectApi:string,fieldApi:string,recordId:string) {
    const definitions=await this.fields(tenantId,objectApi,client);
    const formula=definitions.find(field=>field.api_name===fieldApi&&field.data_type==='formula');
    if(!formula||!formula.formula_expression)
      throw new Error('Formula field definition is unavailable for migration');
    const {rows}=await client.query<{
      field_api:string;data_type:string;value_text:string|null;value_number:string|null;
      value_boolean:boolean|null;value_date:string|null;value_datetime:Date|string|null;
      reference_record_id:string|null;geo_latitude:number|null;geo_longitude:number|null;
      address_street:string|null;address_city:string|null;address_state:string|null;
      address_postal_code:string|null;address_country:string|null
    }>(`SELECT v.field_api,f.data_type,v.value_text,v.value_number::text AS value_number,
        v.value_boolean,v.value_date::text AS value_date,v.value_datetime,v.reference_record_id,
        v.geo_latitude,v.geo_longitude,v.address_street,v.address_city,v.address_state,
        v.address_postal_code,v.address_country
      FROM md_record_values v JOIN md_field_definitions f
        ON f.tenant_id=v.tenant_id AND f.object_api=v.object_api AND f.api_name=v.field_api
      WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.record_id=$3 AND f.deleted_at IS NULL`,
    [tenantId,objectApi,recordId]);
    const {rows:cloneRows}=await client.query<{is_clone:boolean}>(
      'SELECT is_clone FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false',
      [tenantId,objectApi,recordId]);
    const byApi=new Map(rows.map(row=>[row.field_api,row]));
    const record:Record<string,unknown>={Id:recordId,__isClone:cloneRows[0]?.is_clone===true};
    for(const field of definitions){
      if(field.data_type==='formula')continue;
      const row=byApi.get(field.api_name);
      if(!row)continue;
      if(field.data_type==='encryptedtext')record[field.api_name]=null;
      else if(field.data_type==='reference')record[field.api_name]=row.reference_record_id??row.value_text;
      else if(field.data_type==='rollup')
        record[field.api_name]=readRollupSummaryField(field.rollup_source_data_type,row.value_date,row.value_datetime,row.value_number);
      else if(['number','currency','percent'].includes(field.data_type))
        record[field.api_name]=row.value_number===null?null:Number(row.value_number);
      else if(field.data_type==='boolean')record[field.api_name]=row.value_boolean;
      else if(field.data_type==='date')record[field.api_name]=row.value_date;
      else if(field.data_type==='datetime')record[field.api_name]=row.value_datetime===null?null:
        new Date(row.value_datetime).toISOString();
      else if(field.data_type==='address')record[field.api_name]={
        street:row.address_street,city:row.address_city,state:row.address_state,
        postalCode:row.address_postal_code,country:row.address_country
      };
      else if(field.data_type==='geolocation')record[field.api_name]=
        row.geo_latitude===null||row.geo_longitude===null?null:
          {latitude:row.geo_latitude,longitude:row.geo_longitude};
      else record[field.api_name]=row.value_text;
    }
    const formulaContext=await this.formulaContext(
      tenantId,userId,objectApi,record,definitions,client);
    await this.applyFormulaFields(tenantId,userId,objectApi,record,definitions,client,true,formulaContext);
    return record[fieldApi]??null;
  }

  async recalculateRollupForMigration(client:PoolClient,tenantId:string,objectApi:string,fieldApi:string) {
    const field=await client.query<{child_object:string}>(`SELECT rollup_child_object AS child_object
      FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
        AND data_type='rollup' AND deleted_at IS NULL`,
    [tenantId,objectApi,fieldApi]);
    if(!field.rows[0])throw new Error('Roll-Up Summary definition is unavailable for migration');
    const records=await client.query<{id:string}>(
      'SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND is_deleted=false ORDER BY id',
      [tenantId,objectApi]);
    await refreshRollups(client,tenantId,field.rows[0].child_object,
      new Map([[objectApi,new Set(records.rows.map(row=>row.id))]]));
  }

  /** Required lookup filters run for every shared Record write, including APIs,
   * imports, and Flows. Optional criteria remain advisory to the lookup picker. */
  private async enforceRequiredLookupFilters(
    tenantId:string,objectApi:string,prepared:Map<string,Storable>,
    client?:PoolClient,recordId?:string
  ):Promise<void>{
    const executor=client??this.db;
    const {rows}=await executor.query<{
      field_api:string;related_object:string;related_field_api:string;
      operator:LookupFilterMetadata['operator'];value_text:string;
      value_field_api:string|null
    }>(`SELECT l.field_api,f.related_object,l.related_field_api,l.operator,l.value_text,l.value_field_api
      FROM md_object_lookup_filters l JOIN md_field_definitions f
        ON f.tenant_id=l.tenant_id AND f.object_api=l.object_api AND f.api_name=l.field_api
      WHERE l.tenant_id=$1 AND l.object_api=$2 AND l.required=true
        AND f.data_type='reference' AND f.deleted_at IS NULL
      ORDER BY l.field_api,l.sort_order`,[tenantId,objectApi]);
    if(!rows.length)return;
    const targets=[...new Set(rows.map(row=>row.field_api))];
    const previous=recordId?await executor.query<{field_api:string;reference_record_id:string|null}>(
      'SELECT field_api,reference_record_id FROM md_record_values WHERE tenant_id=$1 AND object_api=$2 AND record_id=$3 AND field_api=ANY($4::text[])',
      [tenantId,objectApi,recordId,targets]):{rows:[]};
    const previousMap=new Map(previous.rows.map(row=>[row.field_api,row.reference_record_id]));
    const sourceCache=new Map<string,string|null>();
    const sourceValue=async(name:string):Promise<string|null>=>{
      const preparedValue=prepared.get(name);
      if(preparedValue)return preparedValue.reference_record_id??preparedValue.value_text??null;
      if(sourceCache.has(name))return sourceCache.get(name)??null;
      if(!recordId)return null;
      const stored=await executor.query<{value_text:string|null;reference_record_id:string|null}>(
        'SELECT value_text,reference_record_id FROM md_record_values WHERE tenant_id=$1 AND object_api=$2 AND record_id=$3 AND field_api=$4',
        [tenantId,objectApi,recordId,name]);
      const value=stored.rows[0]?.reference_record_id??stored.rows[0]?.value_text??null;
      sourceCache.set(name,value);
      return value;
    };
    const ruleLogic=await executor.query<{field_api:string;logic:'All'|'Any'}>(
      'SELECT field_api,logic FROM md_object_lookup_filter_logic WHERE tenant_id=$1 AND object_api=$2',
      [tenantId,objectApi]);
    const logic=new Map(ruleLogic.rows.map(row=>[row.field_api,row.logic]));
    for(const fieldApi of targets){
      const lookup=prepared.has(fieldApi)
        ?prepared.get(fieldApi)?.reference_record_id??null
        :previousMap.get(fieldApi)??null;
      if(!lookup)continue;
      const matches:boolean[]=[];
      for(const filter of rows.filter(row=>row.field_api===fieldApi)){
        // Query values through the same tenant boundary without dynamic SQL.
        const target=await executor.query<{
          value_text:string|null;reference_record_id:string|null;id:string
        }>(`SELECT r.id,v.value_text,v.reference_record_id FROM md_records r
          LEFT JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id
            AND v.field_api=$4
          WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.id=$3 AND r.is_deleted=false`,
          [tenantId,filter.related_object,lookup,filter.related_field_api]);
        if(!target.rows[0])throw Error('Invalid required lookup filter: '+fieldApi);
        const actual=filter.related_field_api==='Id'
          ?target.rows[0].id
          :target.rows[0].reference_record_id??target.rows[0].value_text;
        const expected=filter.value_field_api
          ?await sourceValue(filter.value_field_api):filter.value_text;
        matches.push(compareLookupFilter(actual,expected,filter.operator));
      }
      if(!(logic.get(fieldApi)==='Any'?matches.some(Boolean):matches.every(Boolean)))
        throw Error('Invalid required lookup filter: '+fieldApi);
    }
  }

  private async prepare(tenantId:string,userId:string,objectApi:string,values:Record<string,unknown>,creating:boolean,client?:PoolClient,recordId?:string,deferRequired=false) {
    if(Object.getPrototypeOf(values)!==Object.prototype && Object.getPrototypeOf(values)!==null) throw new Error('Invalid record');
    const definitions=await this.fields(tenantId,objectApi,client);
    const fields=new Map(definitions.map(f=>[f.api_name,f]));
    const inputValues={...values};
    if(creating)for(const field of definitions){
      if(inputValues[field.api_name]===undefined&&field.default_value!==null)
        inputValues[field.api_name]=['number','currency','percent'].includes(field.data_type)
          ?Number(field.default_value):field.data_type==='boolean'?field.default_value==='true':field.default_value;
    }
    if(creating&&!deferRequired) for(const field of definitions)
      if(field.required&&!['formula','autonumber'].includes(field.data_type)
        &&field.api_name!=='OwnerId'&&(inputValues[field.api_name]===undefined||inputValues[field.api_name]===null))
        throw new Error('Required field missing: '+field.api_name);
    const prepared=new Map<string,Storable>();
    for(const [key,value] of Object.entries(inputValues)) {
      if(key==='OwnerId'){
        if(typeof value!=='string'||!uuid.test(value))throw Error('Invalid record owner');
        await this.rbac.require(tenantId,userId,objectApi+'.OwnerId',creating?'create':'edit');
        const target=await (client??this.db).query<{id:string;queue:boolean}>(
          "SELECT id,false AS queue FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true UNION ALL SELECT queue_id,true AS queue FROM md_queue_objects WHERE tenant_id=$1 AND queue_id=$2 AND object_api=$3",
          [tenantId,value,objectApi]);
        if(!target.rows[0])throw Error('Record owner not found');
        prepared.set('__OwnerId__',{value_text:value,reference_record_id:null,is_unique:false,case_sensitive:false});
        prepared.set('__OwnerQueue__',{value_text:String(target.rows[0].queue),reference_record_id:null,is_unique:false,case_sensitive:false});
        continue;
      }
      if(key==='RecordTypeId'){
        if(typeof value!=='string'||value.length>128)throw new Error('Invalid record type');
        const {rows}=await (client??this.db).query(
          'SELECT 1 FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2 AND record_type_id=$3 AND active=true',
          [tenantId,objectApi,value]);
        if(!rows.length)throw new Error('Invalid record type');
        await this.rbac.require(tenantId,userId,'RecordType:'+objectApi+'.'+value,'read');
        prepared.set('__RecordTypeId__',{value_text:value,reference_record_id:null,is_unique:false,case_sensitive:false});
        continue;
      }
      const field=fields.get(key);
      if(!field) throw new Error('Unknown field: '+key);
      if(field.data_type==='formula'||field.data_type==='autonumber'||field.data_type==='rollup')
        throw new Error('Field is read-only: '+key);
      await this.rbac.require(tenantId,userId,objectApi+'.'+key,creating?'create':'edit');
      const metadata={is_unique:requiresUniqueValue(field),case_sensitive:field.case_sensitive};
      if(value===null) {
        if(field.required&&!deferRequired)throw new Error('Required field cannot be null: '+key);
        prepared.set(key,{value_text:null,reference_record_id:null,
          ...(field.data_type==='multipicklist'?{multi_values:[]}:{}),...metadata});
        continue;
      }
      let text:string,reference:string|null=null;
      switch(field.data_type) {
        case 'text':
        case 'email':
        case 'phone':
        case 'url':
        case 'image':
        case 'file':
        case 'textarea':
        case 'longtext':
        case 'richtext':
        case 'encryptedtext':
        case 'picklist':
        case 'multipicklist':
          validateTextField(value,key,field.max_length);
          if(field.data_type==='phone')validatePhoneField(value,key);
          if(field.data_type==='email')validateEmailField(value,key);
          if(field.data_type==='url')validateUrlField(value,key);
          if(field.data_type==='image')
            await validateImageAssetField(client??this.db,this.rbac,tenantId,userId,value,key);
          if(field.data_type==='file')
            await validateFileAssetField(client??this.db,this.rbac,tenantId,userId,value,key);
          if(field.data_type==='picklist'&&field.picklist_restricted!==false)
            await validatePicklistField(value,key,()=>this.picklistValues(tenantId,objectApi,key,client));
          if(field.data_type==='multipicklist'&&field.picklist_restricted!==false)
            await validateMultiSelectPicklistField(value,key,()=>this.picklistValues(tenantId,objectApi,key,client));
          text=field.data_type==='richtext'?sanitizeRichText(value):value;
          if(field.data_type==='richtext'&&field.max_length!==null&&field.max_length!==undefined
            &&text.length>field.max_length)
            throw new Error('Invalid text length: '+key);
          if(field.data_type==='encryptedtext'){
            if(!this.encryptedValueVault)throw new Error('Encrypted field vault is unavailable');
            text=encryptFieldValue(this.encryptedValueVault,tenantId,objectApi,key,value);
          }
          break;
        case 'time':
          text=normalizeTimeField(value,key);break;
        case 'currency':
        case 'percent':
        case 'number':
          text=normalizeNumberField(value,key,field.precision,field.scale);break;
        case 'boolean':
          text=normalizeCheckboxField(value,key);break;
        case 'date':
          text=normalizeDateField(value,key);break;
        case 'datetime':
          text=normalizeDateTimeField(value,key);break;
        case 'reference':
          validateLookupField(value,key,field.related_object);
          if(recordId&&field.relationship_type==='Master-Detail'&&!field.allow_reparenting){
            const previous=await (client??this.db).query<{reference_record_id:string|null}>(
              'SELECT reference_record_id FROM md_record_values WHERE tenant_id=$1 AND record_id=$2 AND field_api=$3',
              [tenantId,recordId,key]);
            enforceMasterDetailReparenting(previous.rows[0]?.reference_record_id,value,key,field.allow_reparenting);
          }
          await assertLookupTargetExists(client??this.db,tenantId,field.related_object,value,key,userId);
          // md_record_values.reference_record_id has a foreign key to md_records; users live in
          // md_users, so a User reference is kept as its validated id in value_text.
          if(field.related_object==='User'){text=value;reference=null;break;}
          text='';reference=value;break;
        case 'geolocation': {
          if(!value||typeof value!=='object'||Array.isArray(value))
            throw new Error('Invalid geolocation field: '+key);
          const coordinates=value as Record<string,unknown>;
          const latitude=coordinates.latitude,longitude=coordinates.longitude;
          const validLatitude=latitude===null||(typeof latitude==='number'&&Number.isFinite(latitude)&&latitude>=-90&&latitude<=90);
          const validLongitude=longitude===null||(typeof longitude==='number'&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180);
          if(!validLatitude||!validLongitude||(field.required&&(latitude===null||longitude===null)))
            throw new Error('Invalid geolocation field: '+key);
          text='';
          prepared.set(key,{value_text:null,reference_record_id:null,
            geo_latitude:latitude as number|null,geo_longitude:longitude as number|null,...metadata});
          continue;
        }
        case 'address': {
          if(!value||typeof value!=='object'||Array.isArray(value)
            ||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))
            throw new Error('Invalid address field: '+key);
          const address=value as Record<string,unknown>;
          const limits:Record<string,number>={street:255,city:40,state:80,postalCode:20,country:80};
          const normalized:Record<string,string|null>={};
          for(const [component,limit] of Object.entries(limits)){
            const componentValue=address[component];
            if(componentValue!==undefined&&componentValue!==null
              &&(typeof componentValue!=='string'||componentValue.length>limit))
              throw new Error('Invalid address component: '+component);
            normalized[component]=typeof componentValue==='string'&&componentValue.trim()
              ?componentValue.trim():null;
          }
          if(Object.keys(address).some(component=>!Object.hasOwn(limits,component)))
            throw new Error('Invalid address component');
          if(field.required&&!Object.values(normalized).some(Boolean))
            throw new Error('Required address field is empty: '+key);
          prepared.set(key,{value_text:null,reference_record_id:null,
            address_street:normalized.street,address_city:normalized.city,address_state:normalized.state,
            address_postal_code:normalized.postalCode,address_country:normalized.country,...metadata});
          continue;
        }
        default:throw new Error('Invalid metadata data type: '+field.data_type);
      }
      prepared.set(key,{value_text:reference?null:text,reference_record_id:reference,
        ...(field.data_type==='number'||field.data_type==='currency'||field.data_type==='percent'
          ?{value_number:text}:{}),
        ...(field.data_type==='date'?{value_date:text}:{}),
        ...(field.data_type==='datetime'?{value_datetime:new Date(text)}:{}),
        ...(field.data_type==='boolean'?{value_boolean:value as boolean}:{}),
        ...(field.data_type==='multipicklist'?{multi_values:(value as string).split(';')}:{}),...metadata});
    }
    for(const field of definitions){
      const controllerApi=field.controller_field_api_name;
      if(!controllerApi||(!Object.hasOwn(values,field.api_name)&&!Object.hasOwn(values,controllerApi)))continue;
      let dependentValue=inputValues[field.api_name];
      if(dependentValue===undefined&&recordId){
        const stored=await (client??this.db).query<{value_text:string|null}>(
          'SELECT value_text FROM md_record_values WHERE tenant_id=$1 AND record_id=$2 AND field_api=$3',
          [tenantId,recordId,field.api_name]);
        dependentValue=stored.rows[0]?.value_text;
      }
      if(dependentValue===undefined||dependentValue===null)continue;
      let controllerValue=inputValues[controllerApi];
      if(controllerValue===undefined&&recordId){
        const stored=await (client??this.db).query<{value_text:string|null}>(
          'SELECT value_text FROM md_record_values WHERE tenant_id=$1 AND record_id=$2 AND field_api=$3',
          [tenantId,recordId,controllerApi]);
        controllerValue=stored.rows[0]?.value_text;
      }
      if(typeof controllerValue==='boolean')controllerValue=String(controllerValue);
      if(typeof controllerValue!=='string'||typeof dependentValue!=='string')
        throw new Error('Invalid dependent picklist value: '+field.api_name);
      const allowed=await (client??this.db).query<{picklist_value:string}>(
        `SELECT picklist_value FROM md_field_dependency_values
         WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 AND controller_value=$4
           AND picklist_value=ANY($5::text[])`,
        [tenantId,objectApi,field.api_name,controllerValue,[dependentValue]]);
      if(!allowed.rowCount)throw new Error('Invalid dependent picklist value: '+field.api_name);
    }
    if(creating&&!prepared.has('__RecordTypeId__')){
      const defaults=await (client??this.db).query<{record_type_id:string}>(
        'SELECT record_type_id FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2 AND active=true AND is_default=true ORDER BY sort_order LIMIT 1',
        [tenantId,objectApi]);
      if(defaults.rows[0]){
        const selected=defaults.rows[0].record_type_id;
        await this.rbac.require(tenantId,userId,'RecordType:'+objectApi+'.'+selected,'read');
        prepared.set('__RecordTypeId__',{value_text:selected,reference_record_id:null,is_unique:false,case_sensitive:false});
      }
    }
    // Record-type picklist restrictions are authoritative for API, Flow and import writes.
    // Validate in the same persistence transaction, including old values on a type change.
    const activeType=prepared.get('__RecordTypeId__')?.value_text
      ??(recordId?(await (client??this.db).query<{record_type_id:string|null}>(
        'SELECT record_type_id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false',
        [tenantId,objectApi,recordId])).rows[0]?.record_type_id:null);
    if(activeType){
      const switched=Boolean(recordId&&prepared.has('__RecordTypeId__'));
      const persisted=switched?await (client??this.db).query<{field_api:string;value_text:string|null}>(
        `SELECT v.field_api,v.value_text FROM md_record_values v
          JOIN md_field_definitions f ON f.tenant_id=v.tenant_id AND f.object_api=v.object_api
            AND f.api_name=v.field_api AND f.deleted_at IS NULL
          WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.record_id=$3
            AND f.data_type IN ('picklist','multipicklist')`,
        [tenantId,objectApi,recordId]):{rows:[]};
      const existing=new Map(persisted.rows.map(row=>[row.field_api,row.value_text]));
      for(const field of definitions){
        if(field.data_type!=='picklist'&&field.data_type!=='multipicklist')continue;
        const proposed=prepared.get(field.api_name)?.value_text;
        const selected=prepared.has(field.api_name)?proposed:existing.get(field.api_name);
        if(selected===undefined||selected===null||selected==='')continue;
        const options=field.data_type==='multipicklist'?selected.split(';'): [selected];
        for(const option of options){
          const result=await (client??this.db).query<{allowed:boolean}>(`
            SELECT NOT EXISTS(SELECT 1 FROM md_object_record_type_values
              WHERE tenant_id=$1 AND object_api=$2 AND record_type_id=$3 AND field_api=$4)
              OR EXISTS(SELECT 1 FROM md_object_record_type_values
                WHERE tenant_id=$1 AND object_api=$2 AND record_type_id=$3
                  AND field_api=$4 AND field_value=$5) AS allowed`,
            [tenantId,objectApi,activeType,field.api_name,option]);
          if(result.rows[0]?.allowed===false)
            throw new Error('Invalid record-type picklist value: '+field.api_name);
        }
      }
    }
    if(definitions.some(field=>field.data_type==='reference'))
      await this.enforceRequiredLookupFilters(tenantId,objectApi,prepared,client,recordId);
    return prepared;
  }
  async create(tenantId:string,userId:string,objectApi:string,values:Record<string,unknown>) {
    return this.createRecord(tenantId,userId,objectApi,values,false);
  }
  private async createRecord(tenantId:string,userId:string,objectApi:string,
    values:Record<string,unknown>,isClone:boolean,existingClient?:PoolClient) {
    await this.rbac.require(tenantId,userId,objectApi,'create');
    // External-ID upserts reuse the same before/after Flow contract inside their lock.
    const initialPrepared=await this.prepare(
      tenantId,userId,objectApi,values,true,existingClient,undefined,true);
    const save=async(client:PoolClient)=>{
      await this.lockObjectForWrite(client,tenantId,objectApi);
      const defaults=await this.fields(tenantId,objectApi,client);
      const literals=Object.fromEntries(defaults.filter(field=>field.default_value!==null)
        .map(field=>[field.api_name,['number','currency','percent'].includes(field.data_type)
          ?Number(field.default_value):field.data_type==='boolean'
            ?field.default_value==='true':field.default_value]));
      const lifecycle={stage:isClone?'clone' as const:'create' as const,isClone,
        recordTypeId:initialPrepared.get('__RecordTypeId__')?.value_text??null,now:new Date()};
      let rowValues=await this.declarativeRules.defaults(client,tenantId,userId,objectApi,
        {...values,...(lifecycle.recordTypeId?{RecordTypeId:lifecycle.recordTypeId}:{})},
        literals,lifecycle);
      if(this.recordTrigger){
        const proposed=await this.recordTrigger(client,tenantId,userId,objectApi,'created',
          rowValues,null,'before-save',isClone);
        if(proposed)rowValues={...rowValues,...proposed};
      }
      const finalValues=await this.prepare(tenantId,userId,objectApi,rowValues,true,client);
      const matches=await validateAndMatchRecord(this.declarativeRules,this.recordMatching,
        client,tenantId,userId,objectApi,rowValues,null,undefined,{
          ...lifecycle,recordTypeId:finalValues.get('__RecordTypeId__')?.value_text??null
        });
      const id=await this.insertPrepared(client,tenantId,userId,objectApi,finalValues,isClone);
      await this.recordMatching.save(client,tenantId,objectApi,id,matches);
      if(this.recordTrigger){
        const record=await this.get(tenantId,userId,objectApi,id,client);
        await this.recordTrigger(client,tenantId,userId,objectApi,'created',record,null,'after-save',isClone);
      }
      return id;
    };
    return existingClient?save(existingClient):this.db.transaction(save);
  }
  async createWithTriggersInTransaction(client:PoolClient,tenantId:string,userId:string,
    objectApi:string,values:Record<string,unknown>) {
    return this.createRecord(tenantId,userId,objectApi,values,false,client);
  }
  async clone(tenantId:string,userId:string,objectApi:string,sourceId:string) {
    if(objectApi==='User')throw new Error('User records cannot be cloned');
    await this.rbac.require(tenantId,userId,objectApi,'create');
    const source=await this.get(tenantId,userId,objectApi,sourceId);
    const definitions=await this.fields(tenantId,objectApi);
    const values:Record<string,unknown>={};
    for(const field of definitions){
      if(!Object.hasOwn(source,field.api_name)
        ||['formula','rollup','autonumber','encryptedtext','richtext'].includes(field.data_type)
        ||!await this.rbac.allowed(tenantId,userId,objectApi+'.'+field.api_name,'create'))continue;
      values[field.api_name]=source[field.api_name];
    }
    if(typeof source.RecordTypeId==='string')values.RecordTypeId=source.RecordTypeId;
    return this.createRecord(tenantId,userId,objectApi,values,true);
  }
  /** Reuse the same before-save/after-save trigger contract for Flows, imports and API writes. */
  async createInTransaction(client:PoolClient,tenantId:string,userId:string,objectApi:string,values:Record<string,unknown>) {
    return this.createWithTriggersInTransaction(client,tenantId,userId,objectApi,values);
  }
  /** Shared, atomic CSV/Data Loader import: new records or explicitly selected existing IDs. */
  async importRecords(tenantId:string,userId:string,objectApi:string,records:unknown) {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi) || objectApi==='User')
      throw new Error('Invalid import object');
    if(!Array.isArray(records)||records.length===0||records.length>200)
      throw new Error('Invalid import batch size (1-200 records)');
    const seenIds=new Set<string>();
    const updates=records.map((item:unknown)=>{
      if(!item||typeof item!=='object'||Array.isArray(item)
        ||(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null))
        throw new Error('Invalid import record');
      const data=item as Record<string,unknown>;
      const id=data.Id;
      if(id!==undefined&&(!('Id' in data)||typeof id!=='string'||!uuid.test(id)))
        throw new Error('Invalid import record ID');
      if(typeof id==='string'){
        if(seenIds.has(id.toLowerCase()))throw new Error('Duplicate import record ID');
        seenIds.add(id.toLowerCase());
      }
      const values=Object.fromEntries(Object.entries(data).filter(([key])=>key!=='Id'));
      if(!Object.keys(values).length)throw new Error('Invalid import record without fields');
      return {id,values};
    });
    const mode=updates.every(item=>typeof item.id==='string')?'update'
      :updates.every(item=>item.id===undefined)?'create':null;
    if(!mode)throw new Error('Invalid import batch: cannot mix creates and updates');
    const resultIds:string[]=[];
    await this.db.transaction(async client=>{
      for(const item of updates){
        if(mode==='update'){
          await this.updateInTransaction(client,tenantId,userId,objectApi,item.id as string,item.values);
          resultIds.push(item.id as string);
        }else resultIds.push(await this.createInTransaction(client,tenantId,userId,objectApi,item.values));
      }
    });
    return {count:updates.length,mode,ids:resultIds};
  }
  private async insertPrepared(client:PoolClient,tenantId:string,userId:string,objectApi:string,
    prepared:Map<string,Storable>,isClone=false) {
    if(objectApi==='CashLedger'){
      const proof=await client.query<{allowed:string|null}>(
        "SELECT current_setting('metadrive.cash_ledger_guarded',true) AS allowed");
      if(proof.rows[0]?.allowed!=='yes')
        throw Error('CashLedger records can only be created through an authorised posting Flow');
    }
    const selectedType=prepared.get('__RecordTypeId__')?.value_text??null;
    const selectedOwner=prepared.get('__OwnerId__')?.value_text??userId,queue=prepared.get('__OwnerQueue__')?.value_text==='true';
    const {rows}=await client.query<{id:string}>(
      'INSERT INTO md_records (tenant_id,object_api,record_type_id,owner_id,owner_queue_id,is_clone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [tenantId,objectApi,selectedType,queue?null:selectedOwner,queue?selectedOwner:null,isClone]);
    const autoFields=await client.query<{api_name:string;auto_number_format:string|null;is_unique:boolean;external_id:boolean;case_sensitive:boolean}>(
      `SELECT api_name,auto_number_format,is_unique,external_id,case_sensitive FROM md_field_definitions
       WHERE tenant_id=$1 AND object_api=$2 AND data_type='autonumber' AND deleted_at IS NULL`,[tenantId,objectApi]);
    const rollupFields=await client.query<{api_name:string;operation:string;source_data_type:string|null}>(
      `SELECT f.api_name,f.rollup_operation AS operation,
        (SELECT s.data_type FROM md_field_definitions s
         WHERE s.tenant_id=f.tenant_id AND s.object_api=f.rollup_child_object
           AND s.api_name=f.rollup_source_field AND s.deleted_at IS NULL) AS source_data_type
       FROM md_field_definitions f
       WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.data_type='rollup' AND f.deleted_at IS NULL`,
      [tenantId,objectApi]);
    for(const field of rollupFields.rows)if(typeof field.api_name==='string'){
      const zero=field.operation==='COUNT'||field.operation==='SUM';
      prepared.set(field.api_name,{value_text:zero?'0':null,reference_record_id:null,
        value_number:zero&&field.source_data_type!=='date'&&field.source_data_type!=='datetime'?'0':null,
        value_date:null,value_datetime:null,is_unique:false,case_sensitive:false});
    }
    for(const field of autoFields.rows){
      if(typeof field.api_name!=='string')continue;
      if(prepared.has(field.api_name))continue;
      const counter=await client.query<{sequence:string}>(`INSERT INTO md_auto_number_counters
        (tenant_id,object_api,field_api,next_value) VALUES($1,$2,$3,2)
        ON CONFLICT(tenant_id,object_api,field_api)
        DO UPDATE SET next_value=md_auto_number_counters.next_value+1
        RETURNING (next_value-1)::text AS sequence`,[tenantId,objectApi,field.api_name]);
      const sequence=counter.rows[0]?.sequence;
      if(!sequence)throw new Error('Unable to allocate auto-number value');
      const value=formatAutoNumberValue(field.auto_number_format??'{000000}',Number(sequence));
      prepared.set(field.api_name,{value_text:value,reference_record_id:null,
        is_unique:requiresUniqueValue(field),case_sensitive:field.case_sensitive});
    }
    for(const [field,value] of prepared){if(field.startsWith('__'))continue;await client.query(
      `INSERT INTO md_record_values
        (tenant_id,record_id,object_api,field_api,value_text,reference_record_id,is_unique,case_sensitive,
         geo_latitude,geo_longitude,address_street,address_city,address_state,address_postal_code,address_country,
         value_number,value_date,value_datetime,value_boolean)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [tenantId,rows[0].id,objectApi,field,value.value_text,value.reference_record_id,
        value.is_unique,value.case_sensitive,value.geo_latitude??null,value.geo_longitude??null,
        value.address_street??null,value.address_city??null,value.address_state??null,
        value.address_postal_code??null,value.address_country??null,value.value_number??null,
        value.value_date??null,value.value_datetime??null,value.value_boolean??null]);
      if(value.multi_values)for(const [sortOrder,multiValue] of value.multi_values.entries())
        await client.query(`INSERT INTO md_record_multi_values
          (tenant_id,record_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,
        [tenantId,rows[0].id,objectApi,field,multiValue,sortOrder]);
    }
    const parents=await rollupParents(client,tenantId,objectApi,rows[0].id);
    await refreshRollups(client,tenantId,objectApi,parents);
    return rows[0].id;
  }
  async list(tenantId:string,userId:string,objectApi:string,limit=50,offset=0,
    options:{sortField?:string;sortDirection?:'asc'|'desc';search?:string;prefixSearch?:boolean;filterField?:string;
      filterValue?:string;filterOperator?:'Equals'|'Includes'|'Excludes';
      relatedField?:string;relatedId?:string;filters?:RecordFilter[];filterLogic?:string;
      cursor?:RecordCursor;scope?:'my'|'all'|'my_team'|'queue'}={}) {
    await this.rbac.require(tenantId,userId,objectApi,'read');
    const pageSize=Math.min(Math.max(limit,1),100),start=options.cursor?0:Math.max(offset,0);
    const definitions=await this.fields(tenantId,objectApi);
    const byApi=new Map(definitions.map(field=>[field.api_name,field]));
    const fieldFor=(name:string|undefined)=>{
      if(name===undefined)return undefined;
      if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))throw new Error('Invalid list field');
      const field=byApi.get(name);
      if(!field||['formula','geolocation','address','encryptedtext'].includes(field.data_type))
        throw new Error('Invalid list field');
      return field;
    };
    const sortField=fieldFor(options.sortField);
    const filterField=fieldFor(options.filterField);
    if((options.relatedField===undefined)!==(options.relatedId===undefined))
      throw new Error('Related list requires both relationship field and parent record');
    const relatedField=fieldFor(options.relatedField);
    if(relatedField&&(
      relatedField.data_type!=='reference'||!relatedField.related_object||
      !uuid.test(options.relatedId??'')))
      throw new Error('Invalid related-list relationship');
    const search=options.search?.trim().slice(0,256)??'';
    // Only Smart Lookup opts into prefix matching; other searches are unchanged.
    const searchTerm=options.prefixSearch&&search
      ?(search.match(/[\p{L}\p{N}]+/gu)??[]).slice(0,12).map(part=>part+':*').join(' & ')
      :search;
    const searchFunction=options.prefixSearch?'to_tsquery':'websearch_to_tsquery';
    const filterValue=options.filterValue;
    const filterOperator=options.filterOperator??'Equals';
    if(!['Equals','Includes','Excludes'].includes(filterOperator)
      ||(filterOperator!=='Equals'&&filterField?.data_type!=='multipicklist'))
      throw new Error('Invalid record list filter operator');
    const multiValues=filterField?.data_type==='multipicklist'&&filterOperator!=='Equals'
      ?filterValue?.split(';'):undefined;
    if(multiValues&&(multiValues.some(value=>!value||value.length>512)
      ||multiValues.length>200||new Set(multiValues).size!==multiValues.length))
      throw new Error('Invalid multi-select list filter');
    if(multiValues){
      const configured=new Set(await this.picklistValues(tenantId,objectApi,filterField?.api_name??''));
      if(multiValues.some(value=>!configured.has(value)))
        throw new Error('Invalid multi-select list filter');
    }
    if(options.sortDirection!==undefined&&!['asc','desc'].includes(options.sortDirection))
      throw new Error('Invalid sort direction');
    const readable=new Map<string,boolean>();
    const canRead=async(fieldApi:string)=>{
      if(!readable.has(fieldApi))readable.set(fieldApi,
        await this.rbac.allowed(tenantId,userId,objectApi+'.'+fieldApi,'read'));
      return readable.get(fieldApi)===true;
    };
    if(sortField&&!await canRead(sortField.api_name))throw new Error('Field is not readable');
    if(filterField&&!await canRead(filterField.api_name))throw new Error('Field is not readable');
    if(relatedField){
      if(!await canRead(relatedField.api_name))throw new Error('Field is not readable');
      const parentObject=relatedField.related_object!;
      await this.rbac.require(tenantId,userId,parentObject,'read');
      await this.rbac.requireRecord(tenantId,userId,parentObject,options.relatedId!,'read');
      const parent=await this.db.query(
        'SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false',
        [tenantId,parentObject,options.relatedId]);
      if(!parent.rowCount)throw new Error('Related parent record not found');
    }
    const searchFields:string[]=[];
    let searchFieldParameter:string|undefined;
    let searchTermParameter:string|undefined;
    if(search){
      const {rows:configuredSearchFields}=await this.db.query<{field_api:string}>(`
        SELECT search_fields.field_api FROM md_search_layout_fields search_fields
        LEFT JOIN md_object_manager_settings settings
          ON settings.tenant_id=search_fields.tenant_id AND settings.object_api=search_fields.object_api
        WHERE search_fields.tenant_id=$1 AND search_fields.object_api=$2
          AND COALESCE(settings.allow_search,true) ORDER BY search_fields.field_api`,
      [tenantId,objectApi]);
      for(const {field_api:fieldApi} of configuredSearchFields)
        if(byApi.has(fieldApi)&&await canRead(fieldApi))searchFields.push(fieldApi);
    }
    const predicates:string[]=[];
    const conditionParams:unknown[]=[];
    if(filterField&&filterValue!==undefined){
      conditionParams.push(filterField.api_name);
      const fieldParam='$'+(3+conditionParams.length);
      conditionParams.push(filterValue);
      const valueParam='$'+(3+conditionParams.length);
      if(filterOperator!=='Equals'&&filterField.data_type==='multipicklist'){
        conditionParams[conditionParams.length-1]=multiValues;
        const membership=`COALESCE((SELECT array_agg(mv.value ORDER BY mv.sort_order)
          FROM md_record_multi_values mv WHERE mv.tenant_id=r.tenant_id AND mv.record_id=r.id
            AND mv.object_api=r.object_api AND mv.field_api=${fieldParam}),ARRAY[]::text[]) @> ${valueParam}::text[]`;
        predicates.push(filterOperator==='Includes'
          ?membership
          :`NOT (${membership})`);
      }else if(['number','currency','percent'].includes(filterField.data_type)){
        if(!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(filterValue))
          throw new Error('Invalid numeric list filter');
        predicates.push(`EXISTS(SELECT 1 FROM md_record_values fv
          WHERE fv.tenant_id=r.tenant_id AND fv.record_id=r.id AND fv.object_api=r.object_api
            AND fv.field_api=${fieldParam}
            AND fv.value_text ~ '^-?[0-9]+(\\.[0-9]+)?$'
            AND fv.value_text::numeric=${valueParam}::numeric)`);
      }else predicates.push(`EXISTS(SELECT 1 FROM md_record_values fv
        WHERE fv.tenant_id=r.tenant_id AND fv.record_id=r.id AND fv.object_api=r.object_api
          AND fv.field_api=${fieldParam}
          AND COALESCE(fv.value_text,fv.reference_record_id::text)=${valueParam})`);
    }
    if(relatedField){
      conditionParams.push(relatedField.api_name);
      const relationshipParam='$'+(3+conditionParams.length);
      conditionParams.push(options.relatedId!);
      const parentParam='$'+(3+conditionParams.length);
      predicates.push(`EXISTS(SELECT 1 FROM md_record_values relation
        WHERE relation.tenant_id=r.tenant_id AND relation.record_id=r.id
          AND relation.object_api=r.object_api AND relation.field_api=${relationshipParam}
          AND relation.reference_record_id=${parentParam}::uuid)`);
    }
    if(options.filters?.length){
      // One-level lookup paths (e.g. Product.AgeRestricted) are checked against
      // the lookup field, the related Object and the related Field, and the SQL
      // predicate re-applies record access to the related record.
      const filterFields=new Map<string,QueryField>(byApi);
      for(const filter of options.filters){
        const path=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(filter.field);
        if(!path){
          // Id is the record's system key; its visibility follows record read access.
          if(filter.field!=='Id'&&!await canRead(filter.field))throw new Error('Field is not readable');
          continue;
        }
        const lookup=byApi.get(path[1]);
        if(!lookup||lookup.data_type!=='reference'||!lookup.related_object)
          throw new Error('Invalid list field');
        if(!await canRead(lookup.api_name))throw new Error('Field is not readable');
        const target=lookup.related_object;
        await this.rbac.require(tenantId,userId,target,'read');
        if(!await this.rbac.allowed(tenantId,userId,target+'.'+path[2],'read'))
          throw new Error('Field is not readable');
        const related=(await this.fields(tenantId,target)).find(field=>field.api_name===path[2]);
        if(!related)throw new Error('Invalid list field');
        filterFields.set(filter.field,{...related,
          via:{lookupField:lookup.api_name,access:"md_record_access($1,$3,rel.id,'read')"}});
      }
      const equalityFields=[...new Set(options.filters.filter(filter=>filter.operator==='eq'
        &&filter.field!=='Id'&&!filter.field.includes('.')).map(filter=>filter.field))];
      // One tenant-scoped preference lookup; published list views and ad hoc
      // filters reuse the same QueryBuilder and OneEngine Field readability.
      const indexed=equalityFields.length
       ?await this.db.query<{field_api:string}>(`SELECT field_api FROM md_field_exact_indexes
          WHERE tenant_id=$1 AND object_api=$2 AND enabled
           AND field_api=ANY($3::text[])`,[tenantId,objectApi,equalityFields])
       :{rows:[] as Array<{field_api:string}>};
      const compiled=compileRecordFilters(options.filters,options.filterLogic,filterFields,
        4+conditionParams.length,new Set(indexed.rows.map(row=>row.field_api)));
      predicates.push(compiled.predicate);
      conditionParams.push(...compiled.parameters);
    }else if(options.filterLogic?.trim())throw new Error('Filter logic requires filters');
    if(options.scope==='my')predicates.push('r.owner_id=$3');
    else if(options.scope==='my_team')predicates.push(`r.owner_id IN(
      SELECT user_id FROM md_reporting_users($1,$3,'descendants'))`);
    else if(options.scope==='queue')predicates.push(`r.owner_queue_id IS NOT NULL
      AND md_access_member($1,$3,r.owner_queue_id)`);
    else if(options.scope!==undefined&&options.scope!=='all')throw new Error('Invalid list view scope');
    if(search){
      conditionParams.push(searchFields);
      const fieldsParam='$'+(3+conditionParams.length);
      conditionParams.push(searchTerm);
      const searchParam='$'+(3+conditionParams.length);
      searchFieldParameter=fieldsParam;
      searchTermParameter=searchParam;
      predicates.push(`EXISTS(SELECT 1 FROM md_record_search_values qv
        WHERE qv.tenant_id=r.tenant_id AND qv.record_id=r.id AND qv.object_api=r.object_api
          AND qv.field_api=ANY(${fieldsParam}::text[])
          AND qv.search_vector @@ ${searchFunction}('simple',${searchParam}))`);
    }
    const where=predicates.length?' AND '+predicates.join(' AND '):'';
    let pageCursorPredicate:string|undefined;
    const params:unknown[]=[tenantId,objectApi,userId,...conditionParams];
    let effectiveDirection=options.sortDirection??(search?'desc':'asc');
    let orderBy=search?'r.sort_value DESC,r.created_at ASC,r.id ASC':'r.created_at ASC,r.id ASC';
    let sortSelection=search?'search_rank.score AS sort_value':'r.created_at AS sort_value';
    let resultOrder='r.created_at,r.id,v.field_api';
    let sortJoin='';
    let cursorValueType=search?'numeric':'timestamptz';
    let cursorExpression=search?'search_rank.score':'r.created_at';
    if(search&&!sortField&&searchFieldParameter&&searchTermParameter){
      params.push(searchFields,searchTerm);
      const rankFieldsParam=`$${params.length-1}`;
      const rankTermParam=`$${params.length}`;
      sortJoin=`CROSS JOIN LATERAL (
        SELECT max(ts_rank_cd(setweight(qv.search_vector,qv.weight::"char"),
          ${searchFunction}('simple',${rankTermParam}))) AS score
        FROM md_record_search_values qv
        WHERE qv.tenant_id=r.tenant_id AND qv.record_id=r.id AND qv.object_api=r.object_api
          AND qv.field_api=ANY(${rankFieldsParam}::text[])
          AND qv.search_vector @@ ${searchFunction}('simple',${rankTermParam})
      ) search_rank`;
      orderBy='search_rank.score DESC,r.id ASC';
      resultOrder='r.sort_value DESC,r.id ASC,v.field_api';
    }
    if(sortField){
      params.push(sortField.api_name);
      sortJoin=`LEFT JOIN md_record_values sv ON sv.tenant_id=r.tenant_id AND sv.record_id=r.id
        AND sv.object_api=r.object_api AND sv.field_api=$${params.length}`;
      const direction=options.sortDirection==='desc'?'DESC':'ASC';
      const sortType=sortField.data_type==='rollup'
        ?sortField.rollup_source_data_type:sortField.data_type;
      const sortValue=['number','currency','percent'].includes(String(sortType))
        ?'sv.value_number'
        :sortType==='date'?'sv.value_date'
          :sortType==='datetime'?'sv.value_datetime'
            :sortField.data_type==='reference'?'sv.reference_record_id::text'
              :sortType==='boolean'?'sv.value_boolean'
                :'lower(COALESCE(sv.value_text,sv.reference_record_id::text))';
      sortSelection=`${sortValue} AS sort_value`;
      cursorExpression=sortValue;
      cursorValueType=['number','currency','percent'].includes(String(sortType))?'numeric'
        :sortType==='date'?'date':sortType==='datetime'?'timestamptz'
          :sortType==='boolean'?'boolean':'text';
      orderBy=`${sortValue} ${direction} NULLS LAST,r.id ASC`;
      resultOrder=`r.sort_value ${direction} NULLS LAST,r.id ASC,v.field_api`;
      effectiveDirection=options.sortDirection??'asc';
    }
    if(options.cursor){
      const {field,direction,value,id}=options.cursor;
      if(field!==(sortField?.api_name??null)||direction!==effectiveDirection)
        throw new Error('Record cursor does not match the requested sort');
      params.push(id);
      const idParam=`$${params.length}`;
      if(value===null){
        predicates.push(`${cursorExpression} IS NULL AND r.id>${idParam}::uuid`);
      }else{
        params.push(value);
        const valueParam=`$${params.length}::${cursorValueType}`;
        const comparison=direction==='desc'?'<':'>';
        predicates.push(`(${cursorExpression}${comparison}${valueParam}
          OR ${cursorExpression} IS NULL
          OR (${cursorExpression}=${valueParam} AND r.id>${idParam}::uuid))`);
      }
      pageCursorPredicate=predicates.pop();
    }
    params.push(pageSize,start);
    const limitParam=params.length-1,offsetParam=params.length;
    const slowListStarted=performance.now();
    const {rows}=await this.db.query<{
      id:string|null;created_at:Date|null;updated_at:Date|null;owner_id:string|null;record_type_id:string|null;is_clone:boolean|null;
      total_count:string;
      sort_value:string|Date|null;
      field_api:string|null;value_text:string|null;reference_record_id:string|null;data_type:string|null;
      value_number:string|null;value_date:string|null;value_datetime:Date|null;value_boolean:boolean|null;
      geo_latitude:number|null;geo_longitude:number|null;address_street:string|null;address_city:string|null;
      address_state:string|null;address_postal_code:string|null;address_country:string|null
    }>(`
      WITH authorized AS MATERIALIZED (
        SELECT r.id
        FROM md_records r
        WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
          AND md_record_access($1,$3,r.id,'read')${where}
      ), totals AS (
        SELECT count(*)::text AS total_count FROM authorized
      ), selected AS (
        SELECT r.id,r.created_at,r.updated_at,COALESCE(r.owner_id,r.owner_queue_id) AS owner_id,
          r.record_type_id,r.is_clone,${sortSelection}
        FROM authorized a JOIN md_records r
          ON r.tenant_id=$1 AND r.object_api=$2 AND r.id=a.id
        ${sortJoin}
        ${pageCursorPredicate?`WHERE ${pageCursorPredicate}`:''}
        ORDER BY ${orderBy} LIMIT $${limitParam} OFFSET $${offsetParam}
      )
      SELECT r.id,r.created_at,r.updated_at,r.owner_id,r.record_type_id,r.is_clone,r.sort_value,
        totals.total_count,
        v.field_api,v.value_text,v.reference_record_id,
        v.value_number,v.value_date,v.value_datetime,v.value_boolean,
        v.geo_latitude,v.geo_longitude,v.address_street,v.address_city,v.address_state,v.address_postal_code,
        v.address_country,f.data_type
      FROM totals LEFT JOIN selected r ON true
      LEFT JOIN md_record_values v ON v.tenant_id=$1 AND v.record_id=r.id AND v.object_api=$2
        AND EXISTS(SELECT 1 FROM md_field_definitions active_field
          WHERE active_field.tenant_id=v.tenant_id AND active_field.object_api=v.object_api
            AND active_field.api_name=v.field_api AND active_field.deleted_at IS NULL)
      LEFT JOIN md_field_definitions f ON f.tenant_id=$1 AND f.object_api=$2 AND f.api_name=v.field_api
        AND f.deleted_at IS NULL
      ORDER BY ${resultOrder}
    `,params);
    // Generic slow-list detector: names the Object and the filter fields of any list query that
    // takes over 400 ms, so slow lookups on ANY Object show up in the server log
    // (search the log for "[slow-list]"). Logs field names only, never values.
    const slowListMs=performance.now()-slowListStarted;
    if(slowListMs>400)console.warn('[slow-list] object='+objectApi+' ms='+Math.round(slowListMs)
      +' rows='+rows.length+' filters='+JSON.stringify((options.filters??[]).map(f=>f.field+' '+f.operator))
      +' search='+(search?'yes':'no'));
    const collected=new Map<string,Record<string,unknown>>();
    const allowed=new Map<string,boolean>();
    let lastCursor:RecordCursor|undefined;
    for(const row of rows) {
      if(!row.id)continue;
      if(!collected.has(row.id)){
        collected.set(row.id,{Id:row.id,CreatedAt:row.created_at,
          LastModifiedDate:row.updated_at,OwnerId:row.owner_id,RecordTypeId:row.record_type_id,
          __isClone:row.is_clone===true});
        const rawValue=row.sort_value;
        lastCursor={field:sortField?.api_name??null,
          direction:sortField?(options.sortDirection??'asc'):(search?'desc':'asc'),
          value:rawValue===null?null:rawValue instanceof Date?rawValue.toISOString():String(rawValue),id:row.id};
      }
      if(!row.field_api||row.field_api==='OwnerId')continue;
      if(!allowed.has(row.field_api))allowed.set(row.field_api,await canRead(row.field_api));
      if(!allowed.get(row.field_api))continue;
      const value=row.reference_record_id??row.value_text;
      collected.get(row.id)![row.field_api]=row.data_type==='geolocation'
        ?row.geo_latitude===null&&row.geo_longitude===null?null:{latitude:row.geo_latitude,longitude:row.geo_longitude}
        :row.data_type==='address'
          ?[row.address_street,row.address_city,row.address_state,row.address_postal_code,row.address_country].every(item=>item===null)
            ?null:{street:row.address_street,city:row.address_city,state:row.address_state,postalCode:row.address_postal_code,country:row.address_country}
        :row.data_type==='encryptedtext'
          ?await this.outputFieldValue(tenantId,userId,objectApi,row.field_api,row.id,row.value_text)
        :row.data_type==='rollup'&&byApi.get(row.field_api)?.rollup_source_data_type==='date'
          ?row.value_date
        :row.data_type==='rollup'&&byApi.get(row.field_api)?.rollup_source_data_type==='datetime'
          ?row.value_datetime?new Date(row.value_datetime).toISOString():null
        :value===null?null:
        ['number','currency','percent','rollup'].includes(String(row.data_type))?Number(row.value_number??value):
        row.data_type==='boolean'?(row.value_boolean??value==='true'):
        row.data_type==='date'?(row.value_date??value):
        row.data_type==='datetime'?(row.value_datetime?new Date(row.value_datetime).toISOString():value):value;
    }
    const records=[...collected.values()];
    if(definitions.some(field=>field.data_type==='formula')){
      const formulaNow=new Date();
      const batch:FormulaBatch={visible:new Map()};
      for(const record of records){
        const formulaContext=await this.formulaContext(
          tenantId,userId,objectApi,record,definitions,undefined,formulaNow,batch);
        await this.applyFormulaFields(tenantId,userId,objectApi,record,definitions,undefined,false,formulaContext,batch);
      }
    }
    for(const record of records)delete record.__isClone;
    const nextCursor=records.length&&lastCursor
      &&(lastCursor.value===null||lastCursor.value.length<=512)
      ?Buffer.from(JSON.stringify(lastCursor)).toString('base64url'):undefined;
    return {records,total:Number(rows[0]?.total_count??0),...(nextCursor?{nextCursor}:{})};
  }
  /** Typed SQL filtering with existing Object, Field and Record authorization. */
  async filterTyped(tenantId:string,userId:string,objectApi:string,fieldApi:string,
    operator:'eq'|'lt'|'lte'|'gt'|'gte',raw:string,limit=50,direction:'asc'|'desc'='asc') {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldApi))
      throw new Error('Invalid field reference');
    if(!['eq','lt','lte','gt','gte'].includes(operator))throw new Error('Invalid filter operator');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid record limit');
    if(direction!=='asc'&&direction!=='desc')throw new Error('Invalid sort direction');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    await this.rbac.require(tenantId,userId,objectApi+'.'+fieldApi,'read');
    const {rows:fields}=await this.db.query<{data_type:string;rollup_source_type:string|null}>(`
      SELECT f.data_type,
        (SELECT s.data_type FROM md_field_definitions s
         WHERE s.tenant_id=f.tenant_id AND s.object_api=f.rollup_child_object
           AND s.api_name=f.rollup_source_field AND s.deleted_at IS NULL) AS rollup_source_type
      FROM md_field_definitions f
      WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.api_name=$3`,
      [tenantId,objectApi,fieldApi]);
    const definition=fields[0];
    const type=definition?.data_type==='rollup'?definition.rollup_source_type:definition?.data_type;
    if(!type)throw new Error('Invalid typed filter field');
    const columns:Record<string,string>={number:'value_number',currency:'value_number',
      percent:'value_number',date:'value_date',datetime:'value_datetime',boolean:'value_boolean'};
    const column=columns[type];
    if(!column)throw new Error('Invalid typed filter field');
    const casts:Record<string,string>={value_number:'numeric',value_date:'date',
      value_datetime:'timestamptz',value_boolean:'boolean'};
    if(column==='value_boolean' && operator!=='eq')throw new Error('Invalid boolean comparison');
    const ops={eq:'=',lt:'<',lte:'<=',gt:'>',gte:'>='} as const;
    const {rows}=await this.db.query<{id:string}>(`
      SELECT r.id FROM md_records r JOIN md_record_values v
        ON v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.object_api=r.object_api
      WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false AND v.field_api=$3
        AND v.${column} ${ops[operator]} $4::${casts[column]}
        AND md_record_access($1,$5,r.id,'read')
      ORDER BY v.${column} ${direction==='desc'?'DESC':'ASC'},r.id LIMIT $6
    `,[tenantId,objectApi,fieldApi,raw,userId,limit]);
    return rows.map(row=>row.id);
  }

  /** Numeric aggregation over only records visible to the actor. */
  async aggregateNumeric(tenantId:string,userId:string,objectApi:string,fieldApi:string) {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldApi))
      throw new Error('Invalid field reference');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    await this.rbac.require(tenantId,userId,objectApi+'.'+fieldApi,'read');
    const {rows:fields}=await this.db.query<{data_type:string}>(
      'SELECT data_type FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3',
      [tenantId,objectApi,fieldApi]);
    if(!['number','currency','percent'].includes(fields[0]?.data_type??''))
      throw new Error('Invalid numeric aggregate field');
    const {rows}=await this.db.query<{count:string;sum:string|null;min:string|null;max:string|null;avg:string|null}>(`
      SELECT count(v.value_number)::text AS count,sum(v.value_number)::text AS sum,
        min(v.value_number)::text AS min,max(v.value_number)::text AS max,
        avg(v.value_number)::text AS avg
      FROM md_record_values v JOIN md_records r
        ON r.tenant_id=v.tenant_id AND r.id=v.record_id AND r.object_api=v.object_api
      WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.field_api=$3 AND r.is_deleted=false
        AND md_record_access($1,$4,r.id,'read')`,
      [tenantId,objectApi,fieldApi,userId]);
    return rows[0]??{count:'0',sum:null,min:null,max:null,avg:null};
  }

  /** SQL aggregate shares the same query-builder field, row and lookup access checks as list. */
  async aggregateFiltered(tenantId:string,userId:string,objectApi:string,fieldApi:string,
    filters:RecordFilter[],filterLogic?:string){
    const fields=await this.fields(tenantId,objectApi);
    return computeFilteredNumericAggregate(this.db,this.rbac,
      async name=>name===objectApi?fields:this.fields(tenantId,name),
      tenantId,userId,objectApi,fieldApi,filters,filterLogic);
  }

  /** Single-record read uses the same tenant and field-level grants as list, without pagination. */
  async get(tenantId:string,userId:string,objectApi:string,id:string,client?:PoolClient) {
    if(!uuid.test(id))throw new Error('Invalid record ID');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    const query=client??this.db;
    const {rows}=await query.query<{
      id:string;created_at:Date;updated_at:Date;owner_id:string|null;record_type_id:string|null;is_clone:boolean;
      field_api:string|null;value_text:string|null;reference_record_id:string|null;data_type:string|null;
      value_number:string|null;value_date:string|null;value_datetime:Date|null;value_boolean:boolean|null;
      geo_latitude:number|null;geo_longitude:number|null;address_street:string|null;address_city:string|null;
      address_state:string|null;address_postal_code:string|null;address_country:string|null
    }>(`SELECT r.id,r.created_at,r.updated_at,COALESCE(r.owner_id,r.owner_queue_id) AS owner_id,
      r.record_type_id,r.is_clone,
      v.field_api,v.value_text,v.reference_record_id,f.data_type,v.value_number,v.value_date,v.value_datetime,v.value_boolean,
      v.geo_latitude,v.geo_longitude,v.address_street,v.address_city,v.address_state,v.address_postal_code,v.address_country
      FROM md_records r
      LEFT JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.object_api=r.object_api
        AND EXISTS(SELECT 1 FROM md_field_definitions active_field
          WHERE active_field.tenant_id=v.tenant_id AND active_field.object_api=v.object_api
            AND active_field.api_name=v.field_api AND active_field.deleted_at IS NULL)
      LEFT JOIN md_field_definitions f ON f.tenant_id=r.tenant_id AND f.object_api=r.object_api
        AND f.api_name=v.field_api AND f.deleted_at IS NULL
      WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.id=$3 AND r.is_deleted=false AND md_record_access($1,$4,r.id,'read') ORDER BY v.field_api`,
    [tenantId,objectApi,id,userId]);
    if(!rows.length)throw new Error('Record not found');
    const record:Record<string,unknown>={
      Id:rows[0].id,CreatedAt:rows[0].created_at,
      LastModifiedDate:rows[0].updated_at,OwnerId:rows[0].owner_id,RecordTypeId:rows[0].record_type_id,
      __isClone:rows[0].is_clone===true
    };
    const visible=rows.filter(row=>row.field_api!==null&&row.field_api!=='OwnerId');
    const fields=visible.map(row=>row.field_api as string);
    const access=await this.rbac.allowedMany(tenantId,userId,
      fields.map(field=>({resource:objectApi+'.'+field,action:'read'})));
    for(const [index,row] of visible.entries()){
      if(!access[index])continue;
      const val=row.reference_record_id??row.value_text;
      record[row.field_api as string]=row.data_type==='geolocation'
        ?row.geo_latitude===null&&row.geo_longitude===null?null:{latitude:row.geo_latitude,longitude:row.geo_longitude}
        :row.data_type==='address'
          ?[row.address_street,row.address_city,row.address_state,row.address_postal_code,row.address_country].every(item=>item===null)
            ?null:{street:row.address_street,city:row.address_city,state:row.address_state,postalCode:row.address_postal_code,country:row.address_country}
        :row.data_type==='encryptedtext'
          ?await this.outputFieldValue(tenantId,userId,objectApi,row.field_api as string,row.id,row.value_text)
        :val===null?null:
        ['number','currency','percent','rollup'].includes(String(row.data_type))?Number(row.value_number??val):
        row.data_type==='boolean'?(row.value_boolean??val==='true'):
        row.data_type==='date'?(row.value_date??val):
        row.data_type==='datetime'?(row.value_datetime?new Date(row.value_datetime).toISOString():val):val;
    }
    const definitions=await this.fields(tenantId,objectApi,client);
    if(definitions.some(field=>field.data_type==='formula')){
      const formulaContext=await this.formulaContext(
        tenantId,userId,objectApi,record,definitions,client);
      await this.applyFormulaFields(tenantId,userId,objectApi,record,definitions,client,false,formulaContext);
    }
    delete record.__isClone;
    return record;
  }
  async updateInTransaction(client:PoolClient,tenantId:string,userId:string,objectApi:string,id:string,
    values:Record<string,unknown>,ifUnmodifiedSince?:string) {
    return this.update(tenantId,userId,objectApi,id,values,ifUnmodifiedSince,client,true);
  }
  async updateWithTriggersInTransaction(client:PoolClient,tenantId:string,userId:string,
    objectApi:string,id:string,values:Record<string,unknown>) {
    return this.update(tenantId,userId,objectApi,id,values,undefined,client,true);
  }
  async update(tenantId:string,userId:string,objectApi:string,id:string,values:Record<string,unknown>,
    ifUnmodifiedSince?:string,client?:PoolClient,runTriggers=false) {
    if(!uuid.test(id))throw new Error('Invalid record ID');
    if(objectApi==='CashLedger')throw new Error('CashLedger entries are immutable; post a reversal');
    const checkDate=ifUnmodifiedSince?new Date(ifUnmodifiedSince):null;
    if(checkDate&&!Number.isFinite(checkDate.getTime()))throw new Error('Invalid record modification precondition');
    await this.rbac.require(tenantId,userId,objectApi,'edit');
    if(client)await this.lockObjectForWrite(client,tenantId,objectApi);
    const prepared=await this.prepare(tenantId,userId,objectApi,values,false,client,id);
    const write=async(transactionClient:PoolClient,writeValues:Map<string,Storable>)=>{
      const found=await transactionClient.query<{updated_at:Date}>("SELECT updated_at FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false AND md_record_access($1,$4,id,'edit') FOR UPDATE",
        [tenantId,objectApi,id,userId]);
      if(!found.rowCount)throw new Error('Record not found');
      if(checkDate&&new Date(found.rows[0].updated_at).getTime()>checkDate.getTime()+999)
        throw new Error('Record has changed since it was loaded');
      // Recheck required relationship rules under the record write lock to close
      // the interval between UI/API validation and transactional persistence.
      if((await this.fields(tenantId,objectApi,transactionClient)).some(f=>f.data_type==='reference'))
        await this.enforceRequiredLookupFilters(tenantId,objectApi,writeValues,transactionClient,id);
      const affectedParents=await rollupParents(transactionClient,tenantId,objectApi,id);
      if(writeValues.has('__OwnerId__')){
        const queue=writeValues.get('__OwnerQueue__')?.value_text==='true',owner=writeValues.get('__OwnerId__')?.value_text;
        await transactionClient.query('UPDATE md_records SET owner_id=$4,owner_queue_id=$5 WHERE tenant_id=$1 AND object_api=$2 AND id=$3',
          [tenantId,objectApi,id,queue?null:owner,queue?owner:null]);
      }
      if(writeValues.has('__RecordTypeId__'))await transactionClient.query(
        'UPDATE md_records SET record_type_id=$4,updated_at=now() WHERE tenant_id=$1 AND object_api=$2 AND id=$3',
        [tenantId,objectApi,id,writeValues.get('__RecordTypeId__')?.value_text]);
      else await transactionClient.query('UPDATE md_records SET updated_at=now() WHERE tenant_id=$1 AND object_api=$2 AND id=$3',
        [tenantId,objectApi,id]);
      for(const [field,value] of writeValues){
        if(field.startsWith('__'))continue;
        const previous=await transactionClient.query<{value_text:string|null;reference_record_id:string|null;geo_latitude:number|null;geo_longitude:number|null;address_street:string|null;address_city:string|null;address_state:string|null;address_postal_code:string|null;address_country:string|null}>(
          'SELECT value_text,reference_record_id,geo_latitude,geo_longitude,address_street,address_city,address_state,address_postal_code,address_country FROM md_record_values WHERE tenant_id=$1 AND record_id=$2 AND field_api=$3',
          [tenantId,id,field]);
        const before=previous.rows[0]?.reference_record_id??previous.rows[0]?.value_text
          ??(previous.rows[0]?.geo_latitude!==null&&previous.rows[0]?.geo_latitude!==undefined
            ?`${previous.rows[0].geo_latitude},${previous.rows[0].geo_longitude??''}`:null);
        const after=value.reference_record_id??value.value_text
          ??(value.geo_latitude!==undefined?`${value.geo_latitude??''},${value.geo_longitude??''}`:null);
        const oldAddress=value.address_street!==undefined&&previous.rows[0]
          ?[previous.rows[0].address_street,previous.rows[0].address_city,
            previous.rows[0].address_state,previous.rows[0].address_postal_code,previous.rows[0].address_country].join('|')
          :undefined;
        const newAddress=value.address_street!==undefined?[value.address_street,value.address_city,
          value.address_state,value.address_postal_code,value.address_country].join('|'):undefined;
        if(before!==after||oldAddress!==newAddress)await transactionClient.query(
          'INSERT INTO md_record_history(tenant_id,record_id,object_api,field_api,changed_by,old_value,new_value) '+
          'SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS ('+
          'SELECT 1 FROM md_field_definitions f JOIN md_object_manager_settings settings '+
          'ON settings.tenant_id=f.tenant_id AND settings.object_api=f.object_api '+
          'WHERE f.tenant_id=$1 AND f.object_api=$3 AND f.api_name=$4 AND f.track_history=true '+
          'AND settings.track_field_history=true AND f.data_type<>\'encryptedtext\' AND f.deleted_at IS NULL)',
          [tenantId,id,objectApi,field,userId,oldAddress??before,newAddress??after]);
      }
      for(const [field,value] of writeValues){if(field.startsWith('__'))continue;await transactionClient.query(`
        INSERT INTO md_record_values
          (tenant_id,record_id,object_api,field_api,value_text,reference_record_id,is_unique,case_sensitive,
           geo_latitude,geo_longitude,address_street,address_city,address_state,address_postal_code,address_country,
           value_number,value_date,value_datetime,value_boolean)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (tenant_id,record_id,field_api)
        DO UPDATE SET value_text=EXCLUDED.value_text,reference_record_id=EXCLUDED.reference_record_id,
          is_unique=EXCLUDED.is_unique,case_sensitive=EXCLUDED.case_sensitive,
          geo_latitude=EXCLUDED.geo_latitude,geo_longitude=EXCLUDED.geo_longitude,
          address_street=EXCLUDED.address_street,address_city=EXCLUDED.address_city,
          address_state=EXCLUDED.address_state,address_postal_code=EXCLUDED.address_postal_code,
          address_country=EXCLUDED.address_country,value_number=EXCLUDED.value_number,
          value_date=EXCLUDED.value_date,value_datetime=EXCLUDED.value_datetime,
          value_boolean=EXCLUDED.value_boolean
      `,[tenantId,id,objectApi,field,value.value_text,value.reference_record_id,
        value.is_unique,value.case_sensitive,value.geo_latitude??null,value.geo_longitude??null,
        value.address_street??null,value.address_city??null,value.address_state??null,
        value.address_postal_code??null,value.address_country??null,value.value_number??null,
        value.value_date??null,value.value_datetime??null,value.value_boolean??null]);
        if(value.multi_values){
          await transactionClient.query('DELETE FROM md_record_multi_values WHERE tenant_id=$1 AND record_id=$2 AND field_api=$3',
            [tenantId,id,field]);
          for(const [sortOrder,multiValue] of value.multi_values.entries())await transactionClient.query(
            `INSERT INTO md_record_multi_values
              (tenant_id,record_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,
            [tenantId,id,objectApi,field,multiValue,sortOrder]);
        }
      }
      if(this.richTextFilePruner){
        const richTextFields=(await this.fields(tenantId,objectApi,transactionClient))
          .filter(field=>field.data_type==='richtext'&&writeValues.has(field.api_name));
        for(const field of richTextFields)
          await this.richTextFilePruner(transactionClient,tenantId,objectApi,id,field.api_name,
            writeValues.get(field.api_name)?.value_text??null);
      }
      const currentParents=await rollupParents(transactionClient,tenantId,objectApi,id);
      for(const [parentObject,parentIds] of currentParents){
        const affected=affectedParents.get(parentObject)??new Set<string>();
        for(const parentId of parentIds)affected.add(parentId);
        affectedParents.set(parentObject,affected);
      }
      await refreshRollups(transactionClient,tenantId,objectApi,affectedParents);
    };
    if(client){
      let previous:Record<string,unknown>|undefined;
      const loadPrior=async()=>previous??(previous=await this.get(tenantId,userId,objectApi,id,client));
      const prior=await loadPrior();
      let writeValues=prepared;
      if(runTriggers&&this.recordTrigger){
        const proposed=await this.recordTrigger(client,tenantId,userId,objectApi,'updated',
          {...prior,...values},prior,'before-save');
        if(proposed){
          const changed={...values};
          for(const [field,value] of Object.entries(proposed))
            if(!['Id','CreatedAt','LastModifiedDate','OwnerId','RecordTypeId'].includes(field)
               &&!Object.is(value,prior?.[field]))changed[field]=value;
          writeValues=await this.prepare(tenantId,userId,objectApi,changed,false,client,id);
        }
      }
      const proposedValues={...(prior??{}),...values};
      if(runTriggers){
        const declaredTypes=new Map((await this.fields(tenantId,objectApi,client))
          .map(field=>[field.api_name,field.data_type]));
        for(const [field,value] of writeValues){
          if(field.startsWith('__'))continue;
          const type=declaredTypes.get(field);
          proposedValues[field]=value.reference_record_id??(
            type==='boolean'?value.value_boolean:
            ['number','currency','percent'].includes(type??'')
              ?(value.value_number===null||value.value_number===undefined?null:Number(value.value_number))
              :value.value_text);
        }
      }
      const snapshot=async()=>({...await loadPrior(),...proposedValues});
      const lifecycle={stage:'update' as const,
        now:new Date(),
        recordTypeId:writeValues.get('__RecordTypeId__')?.value_text
          ??(typeof prior.RecordTypeId==='string'?prior.RecordTypeId:null)};
      const matches=await validateAndMatchRecord(this.declarativeRules,this.recordMatching,
        client,tenantId,userId,objectApi,snapshot,loadPrior,id,lifecycle);
      await write(client,writeValues);
      await this.recordMatching.save(client,tenantId,objectApi,id,matches);
      if(runTriggers&&this.recordTrigger){
        const record=await this.get(tenantId,userId,objectApi,id,client);
        await this.recordTrigger(client,tenantId,userId,objectApi,'updated',record,prior,'after-save');
      }
    }
    else await this.db.transaction(async transactionClient=>{
      await this.lockObjectForWrite(transactionClient,tenantId,objectApi);
      const locked=await transactionClient.query(
        "SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false AND md_record_access($1,$4,id,'edit') FOR UPDATE",
        [tenantId,objectApi,id,userId]);
      if(!locked.rowCount)throw new Error('Record not found');
      const prior=await this.get(tenantId,userId,objectApi,id,transactionClient);
      let finalPrepared=prepared;
      finalPrepared=await this.prepare(tenantId,userId,objectApi,values,false,transactionClient,id);
      if(this.recordTrigger){
        const proposed=await this.recordTrigger(transactionClient,tenantId,userId,objectApi,'updated',
          {...prior,...values},prior,'before-save');
        if(proposed){
          const changed={...values};
          for(const [field,value] of Object.entries(proposed))
            if(!['Id','CreatedAt','LastModifiedDate','OwnerId','RecordTypeId'].includes(field)
              &&!Object.is(value,prior[field]))changed[field]=value;
          finalPrepared=await this.prepare(tenantId,userId,objectApi,changed,false,transactionClient,id);
        }
      }
      const proposedValues={...prior,...values};
      const declaredTypes=new Map((await this.fields(tenantId,objectApi,transactionClient))
        .map(field=>[field.api_name,field.data_type]));
      for(const [field,value] of finalPrepared){
        if(field.startsWith('__'))continue;
        const type=declaredTypes.get(field);
        proposedValues[field]=value.reference_record_id??(
          type==='boolean'?value.value_boolean:
          ['number','currency','percent'].includes(type??'')
            ?(value.value_number===null||value.value_number===undefined?null:Number(value.value_number))
            :value.value_text);
      }
      const matches=await validateAndMatchRecord(this.declarativeRules,this.recordMatching,
        transactionClient,tenantId,userId,objectApi,proposedValues,prior,id,{
          stage:'update',now:new Date(),recordTypeId:finalPrepared.get('__RecordTypeId__')?.value_text
            ??(typeof prior.RecordTypeId==='string'?prior.RecordTypeId:null)
        });
      await write(transactionClient,finalPrepared);
      await this.recordMatching.save(transactionClient,tenantId,objectApi,id,matches);
      if(this.recordTrigger){
        const record=await this.get(tenantId,userId,objectApi,id,transactionClient);
        await this.recordTrigger(transactionClient,tenantId,userId,objectApi,'updated',record,prior,'after-save');
      }
    });
  }
  async history(tenantId:string,userId:string,objectApi:string,id:string){
    if(!uuid.test(id)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi))throw new Error('Invalid record reference');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    await this.rbac.requireRecord(tenantId,userId,objectApi,id,'read');
    const found=await this.db.query('SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false',[tenantId,objectApi,id]);
    if(!found.rowCount)throw new Error('Record not found');
    const {rows}=await this.db.query<{id:string;field_api:string;changed_by:string;changed_at:Date;old_value:string|null;new_value:string|null}>(
      'SELECT h.id,h.field_api,h.changed_by,h.changed_at,h.old_value,h.new_value FROM md_record_history h '+
      'JOIN md_field_definitions f ON f.tenant_id=h.tenant_id AND f.object_api=h.object_api AND f.api_name=h.field_api '+
      'JOIN md_object_manager_settings settings ON settings.tenant_id=h.tenant_id AND settings.object_api=h.object_api '+
      'WHERE h.tenant_id=$1 AND h.object_api=$2 AND h.record_id=$3 AND f.track_history=true '+
      'AND settings.track_field_history=true AND f.data_type<>\'encryptedtext\' AND f.deleted_at IS NULL '+
      'ORDER BY h.changed_at DESC,h.id DESC LIMIT 100',
      [tenantId,objectApi,id]);
    const readable=new Map<string,boolean>();
    const history=[];
    for(const row of rows){
      if(!readable.has(row.field_api))readable.set(row.field_api,
        await this.rbac.allowed(tenantId,userId,objectApi+'.'+row.field_api,'read'));
      if(!readable.get(row.field_api))continue;
      history.push({id:row.id,fieldApiName:row.field_api,changedBy:row.changed_by,
        changedAt:new Date(row.changed_at).toISOString(),oldValue:row.old_value,newValue:row.new_value});
    }
    return {history};
  }
  /** Transfer record ownership without bypassing Object/Record permissions or tenant boundaries. */
  async transferOwner(tenantId:string,userId:string,objectApi:string,id:string,ownerId:string,ifUnmodifiedSince?:string){
    if(!uuid.test(id)||!uuid.test(ownerId)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi))
      throw new Error('Invalid record ownership');
    await this.rbac.require(tenantId,userId,objectApi,'edit');
    await this.rbac.require(tenantId,userId,objectApi+'.OwnerId','edit');
    let revisionDate:Date|undefined;
    if(ifUnmodifiedSince){
      revisionDate=new Date(ifUnmodifiedSince);
      if(!Number.isFinite(revisionDate.getTime()))throw new Error('Invalid record modification precondition');
    }
    return this.db.transaction(async client=>{
      const target=await client.query<{id:string;queue:boolean}>("SELECT id,false AS queue FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true UNION ALL SELECT q.queue_id,true AS queue FROM md_queue_objects q WHERE q.tenant_id=$1 AND q.queue_id=$2 AND q.object_api=$3",[tenantId,ownerId,objectApi]);
      if(!target.rowCount)throw new Error('Record owner not found');
      const found=await client.query<{updated_at:Date}>(
        "SELECT updated_at FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false AND md_record_access($1,$4,id,'edit') FOR UPDATE",
        [tenantId,objectApi,id,userId]);
      if(!found.rows[0])throw new Error('Record not found');
      if(revisionDate&&new Date(found.rows[0].updated_at).getTime()>revisionDate.getTime()+999)
        throw new Error('Record has changed since it was loaded');
      const {rows}=await client.query<{owner_id:string;updated_at:Date}>(
        'UPDATE md_records SET owner_id=$4,owner_queue_id=$5,updated_at=now() WHERE tenant_id=$1 AND object_api=$2 AND id=$3 RETURNING COALESCE(owner_id,owner_queue_id) AS owner_id,updated_at',
        [tenantId,objectApi,id,target.rows[0].queue?null:ownerId,target.rows[0].queue?ownerId:null]);
      return {Id:id,OwnerId:rows[0].owner_id,LastModifiedDate:rows[0].updated_at};
    });
  }
  /** Retain business records and their dependent SQL rows for recoverable deletion. */
  private async removeRecordTree(client:PoolClient,tenantId:string,userId:string,objectApi:string,id:string,
    root:boolean,visiting:Set<string>,deletionGroupId:string,rootId:string){
    if(objectApi==='CashLedger')throw Error('CashLedger entries cannot be deleted; post a reversal');
    await this.lockObjectForWrite(client,tenantId,objectApi);
    const recordKey=JSON.stringify([objectApi,id]);
    if(visiting.has(recordKey))throw new Error('Cascading relationship record cycle detected');
    const record=await client.query<{id:string}>(root
      ?`SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3
         AND is_deleted=false AND md_record_access($1,$4,id,'delete') FOR UPDATE`
      :`SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3
         AND is_deleted=false FOR UPDATE`,
    root?[tenantId,objectApi,id,userId]:[tenantId,objectApi,id]);
    if(!record.rowCount){
      if(root)throw new Error('Record not found');
      return;
    }
    // A configured Master-Detail or Lookup Cascade is a platform-owned
    // consequence of deleting the parent. The actor must be authorised to
    // delete the root, but does not need separate visibility or delete grants
    // on every descendant. A direct child deletion still enters as root=true
    // and enforces the child record's normal permission/restriction policy.
    // This intentionally matches Salesforce cascade-delete behaviour.
    const affectedParents=await rollupParents(client,tenantId,objectApi,id);
    visiting.add(recordKey);
    const references=await registeredRelationships(client,tenantId,{recordId:id,objectApi});
    assertDeletionAllowed(references);
    const cascaded=new Set<string>();
    for(const reference of references){
      if(!shouldCascadeReference(reference))continue;
      const key=JSON.stringify([reference.object_api,reference.record_id]);
      if(cascaded.has(key))continue;
      cascaded.add(key);
      await this.removeRecordTree(client,tenantId,userId,reference.object_api,reference.record_id,
        false,visiting,deletionGroupId,rootId);
    }
    for(const reference of references){
      if(reference.relationship_type!=='Hierarchical'
        &&!(reference.relationship_type==='Lookup'&&(reference.delete_behavior??'Clear')==='Clear'))continue;
      await client.query(`INSERT INTO md_deleted_lookup_links
        (tenant_id,deletion_group_id,source_record_id,source_object_api,field_api,target_record_id)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [tenantId,deletionGroupId,reference.record_id,reference.object_api,reference.field_api,id]);
      const cleared=await client.query<{record_id:string;object_api:string;field_api:string}>(
        `UPDATE md_record_values SET value_text=NULL,reference_record_id=NULL
         WHERE tenant_id=$1 AND record_id=$2 AND field_api=$3 AND reference_record_id=$4
         RETURNING record_id,object_api,field_api`,
        [tenantId,reference.record_id,reference.field_api,id]);
      if(!cleared.rowCount)continue;
      await client.query('UPDATE md_records SET updated_at=now() WHERE tenant_id=$1 AND id=$2',
        [tenantId,reference.record_id]);
      await client.query(`INSERT INTO md_record_history
        (tenant_id,record_id,object_api,field_api,changed_by,old_value,new_value)
        VALUES($1,$2,$3,$4,$5,$6,NULL)`,
      [tenantId,reference.record_id,reference.object_api,reference.field_api,userId,id]);
    }
    await client.query(`UPDATE md_record_values SET record_is_deleted=true
      WHERE tenant_id=$1 AND object_api=$2 AND record_id=$3`,
      [tenantId,objectApi,id]);
    await client.query(`UPDATE md_records SET is_deleted=true,deleted_at=now(),deleted_by=$4,
      deletion_group_id=$5,deletion_root_id=$6,updated_at=now()
      WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false`,
      [tenantId,objectApi,id,userId,deletionGroupId,rootId]);
    await refreshRollups(client,tenantId,objectApi,affectedParents);
    visiting.delete(recordKey);
  }

  /** Object-level delete permission and record access are checked for the root. */
  async remove(tenantId:string,userId:string,objectApi:string,id:string,client?:PoolClient,ifUnmodifiedSince?:string) {
    if(objectApi==='CashLedger')throw Error('CashLedger entries cannot be deleted; post a reversal');
    if(!uuid.test(id)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi))
      throw new Error('Invalid record reference');
    const checkDate=ifUnmodifiedSince?new Date(ifUnmodifiedSince):null;
    if(checkDate&&!Number.isFinite(checkDate.getTime()))throw Error('Invalid record modification precondition');
    await this.rbac.require(tenantId,userId,objectApi,'delete');
    const run=async(transactionClient:PoolClient)=>{
      await this.lockObjectForWrite(transactionClient,tenantId,objectApi);
      const locked=await transactionClient.query<{id:string;updated_at:Date}>(
        "SELECT id,updated_at FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false AND md_record_access($1,$4,id,'delete') FOR UPDATE",
        [tenantId,objectApi,id,userId]);
      if(!locked.rowCount)throw new Error('Record not found');
      if(checkDate&&new Date(locked.rows[0].updated_at).getTime()>checkDate.getTime()+999)
        throw new Error('Record has changed since it was loaded');
      const prior=this.recordTrigger
        ?await this.get(tenantId,userId,objectApi,id,transactionClient):null;
      const group=await transactionClient.query<{id:string}>(
        'SELECT gen_random_uuid()::text AS id');
      const deletionGroupId=group.rows[0].id;
      await this.removeRecordTree(transactionClient,tenantId,userId,objectApi,id,
        true,new Set(),deletionGroupId,id);
      await transactionClient.query(`INSERT INTO md_record_lifecycle_audit
        (tenant_id,record_id,object_api,deletion_group_id,actor_id,operation)
        VALUES($1,$2,$3,$4,$5,'delete')`,
        [tenantId,id,objectApi,deletionGroupId,userId]);
      if(this.recordTrigger)
        await this.recordTrigger(transactionClient,tenantId,userId,objectApi,'deleted',prior,prior,'after-save');
    };
    if(client)await run(client);
    else await this.db.transaction(run);
  }

  /** Deleted record metadata only; fields remain subject to normal Field permissions. */
  async recycleBin(tenantId:string,userId:string,objectApi:string,limit=50,offset=0){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)
      ||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)
      throw new Error('Invalid Recycle Bin request');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    await this.rbac.require(tenantId,userId,objectApi,'delete');
    const count=await this.db.query<{total:string}>(`
      SELECT count(*)::text AS total FROM md_records
      WHERE tenant_id=$1 AND object_api=$2 AND is_deleted=true
        AND deletion_root_id=id AND md_record_access($1,$3,id,'delete')`,
      [tenantId,objectApi,userId]);
    const {rows}=await this.db.query<{
      id:string;deleted_at:Date;deleted_by:string;deletion_group_id:string
    }>(`SELECT id,deleted_at,deleted_by,deletion_group_id FROM md_records
      WHERE tenant_id=$1 AND object_api=$2 AND is_deleted=true
        AND deletion_root_id=id AND md_record_access($1,$3,id,'delete')
      ORDER BY deleted_at DESC,id LIMIT $4 OFFSET $5`,
      [tenantId,objectApi,userId,limit,offset]);
    return {records:rows.map(row=>({
      Id:row.id,DeletedAt:new Date(row.deleted_at).toISOString(),
      DeletedBy:row.deleted_by,DeletionGroupId:row.deletion_group_id
    })),total:Number(count.rows[0]?.total??0)};
  }

  /** Recover the exact deletion group; never overwrite a subsequently edited lookup. */
  async restore(tenantId:string,userId:string,objectApi:string,id:string){
    if(!uuid.test(id)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi))
      throw new Error('Invalid record reference');
    await this.rbac.require(tenantId,userId,objectApi,'create');
    await this.rbac.require(tenantId,userId,objectApi,'delete');
    return this.db.transaction(async client=>{
      await this.lockObjectForWrite(client,tenantId,objectApi);
      const root=await client.query<{deletion_group_id:string;deletion_root_id:string}>(`
        SELECT deletion_group_id,deletion_root_id FROM md_records
        WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=true
          AND md_record_access($1,$4,id,'delete') FOR UPDATE`,
        [tenantId,objectApi,id,userId]);
      const record=root.rows[0];
      if(!record)throw new Error('Deleted record not found or unavailable');
      if(record.deletion_root_id!==id)throw new Error('Restore the deleted parent record');
      const {rows}=await client.query<{id:string;object_api:string}>(`
        SELECT id,object_api FROM md_records
        WHERE tenant_id=$1 AND deletion_group_id=$2 AND is_deleted=true
        ORDER BY object_api,id FOR UPDATE`,[tenantId,record.deletion_group_id]);
      // Restore never bypasses Object and Record permissions for cascaded detail records.
      for(const item of rows){
        await this.rbac.require(tenantId,userId,item.object_api,'create');
        await this.rbac.require(tenantId,userId,item.object_api,'delete');
        await this.rbac.requireRecord(tenantId,userId,item.object_api,item.id,'delete');
      }
      // A previously deleted master outside this group must not be resurrected implicitly.
      const external=await client.query(`
        SELECT 1 FROM md_record_values v
        JOIN md_field_definitions f ON f.tenant_id=v.tenant_id
          AND f.object_api=v.object_api AND f.api_name=v.field_api
          AND f.relationship_type='Master-Detail' AND f.deleted_at IS NULL
        JOIN md_records parent ON parent.tenant_id=v.tenant_id AND parent.id=v.reference_record_id
        WHERE v.tenant_id=$1 AND v.record_id=ANY($2::uuid[])
          AND parent.is_deleted=true AND parent.deletion_group_id IS DISTINCT FROM $3::uuid
        LIMIT 1`,[tenantId,rows.map(row=>row.id),record.deletion_group_id]);
      if(external.rowCount)throw new Error('Restore the master record first');
      await client.query(`UPDATE md_record_values v SET record_is_deleted=false
        FROM md_records r
        WHERE v.tenant_id=r.tenant_id AND v.record_id=r.id AND
          r.tenant_id=$1 AND r.deletion_group_id=$2 AND r.is_deleted=true`,
        [tenantId,record.deletion_group_id]);
      await client.query(`UPDATE md_records SET is_deleted=false,deleted_at=NULL,deleted_by=NULL,
        deletion_group_id=NULL,deletion_root_id=NULL,updated_at=now()
        WHERE tenant_id=$1 AND deletion_group_id=$2 AND is_deleted=true`,
        [tenantId,record.deletion_group_id]);
      const {rows:links}=await client.query<{
        source_record_id:string;source_object_api:string;field_api:string;target_record_id:string
      }>(`SELECT source_record_id,source_object_api,field_api,target_record_id
        FROM md_deleted_lookup_links WHERE tenant_id=$1 AND deletion_group_id=$2`,
        [tenantId,record.deletion_group_id]);
      for(const link of links){
        const resource=link.source_object_api+'.'+link.field_api;
        if(!await this.rbac.allowed(tenantId,userId,link.source_object_api,'edit')
          ||!await this.rbac.allowed(tenantId,userId,resource,'edit'))continue;
        try {
          await this.rbac.requireRecord(tenantId,userId,link.source_object_api,link.source_record_id,'edit');
        } catch {continue;}
        const restored=await client.query(`UPDATE md_record_values v
          SET value_text='',reference_record_id=$5::uuid
          FROM md_records source,md_records target,md_field_definitions field
          WHERE v.tenant_id=$1 AND v.record_id=$2 AND v.object_api=$3 AND v.field_api=$4
            AND v.reference_record_id IS NULL AND v.value_text IS NULL
            AND source.tenant_id=v.tenant_id AND source.id=v.record_id AND source.is_deleted=false
            AND target.tenant_id=v.tenant_id AND target.id=$5::uuid AND target.is_deleted=false
            AND field.tenant_id=v.tenant_id AND field.object_api=v.object_api
            AND field.api_name=v.field_api AND field.related_object=target.object_api
            AND field.deleted_at IS NULL RETURNING v.record_id`,
          [tenantId,link.source_record_id,link.source_object_api,link.field_api,
            link.target_record_id]);
        if(restored.rowCount){
          await client.query(`DELETE FROM md_deleted_lookup_links
            WHERE tenant_id=$1 AND deletion_group_id=$2 AND source_record_id=$3 AND field_api=$4`,
            [tenantId,record.deletion_group_id,link.source_record_id,link.field_api]);
          await client.query('UPDATE md_records SET updated_at=now() WHERE tenant_id=$1 AND object_api=$2 AND id=$3',
            [tenantId,link.source_object_api,link.source_record_id]);
          const sourceParents=await rollupParents(client,tenantId,link.source_object_api,link.source_record_id);
          await refreshRollups(client,tenantId,link.source_object_api,sourceParents);
          await client.query(`INSERT INTO md_record_history
            (tenant_id,record_id,object_api,field_api,changed_by,old_value,new_value)
            VALUES($1,$2,$3,$4,$5,NULL,$6)`,
            [tenantId,link.source_record_id,link.source_object_api,link.field_api,userId,link.target_record_id]);
        }
      }
      // Keep unresolved recovery links for privileged/manual reconciliation.
      // Never discard them when a source Field or the user's edit rights have changed.
      const outstanding=await client.query<{total:number}>(`SELECT count(*)::integer AS total
        FROM md_deleted_lookup_links WHERE tenant_id=$1 AND deletion_group_id=$2`,
        [tenantId,record.deletion_group_id]);
      for(const restored of rows){
        const parents=await rollupParents(client,tenantId,restored.object_api,restored.id);
        await refreshRollups(client,tenantId,restored.object_api,parents);
      }
      await client.query(`INSERT INTO md_record_lifecycle_audit
        (tenant_id,record_id,object_api,deletion_group_id,actor_id,operation)
        VALUES($1,$2,$3,$4,$5,'restore')`,
        [tenantId,id,objectApi,record.deletion_group_id,userId]);
      return {restored:rows.length,unresolvedLookupLinks:outstanding.rows[0]?.total??0};
    }).catch((error:unknown)=>{
      if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')
        throw new Error('Restore conflicts with an existing unique field value');
      throw error;
    });
  }
}
