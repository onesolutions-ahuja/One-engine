import {requireAvailableMetadataName} from '../system-support/metadata-name-guard.js';
import type {PoolClient} from 'pg';
import type {RbacEngine} from './rbac-engine.js';
import type {SqlExecutor,SqlPersistence} from './sql-persistence.js';

export type CustomFieldType='text'|'number'|'boolean'|'date'|'datetime';
export type CustomScalar=string|number|boolean;
export type CustomFieldDefinition={
  apiName:string;label:string;dataType:CustomFieldType;required?:boolean;maxLength?:number;
};
export type CustomMetadataTypeInput={
  apiName:string;label:string;description?:string;fields:CustomFieldDefinition[];
};
export type CustomSettingInput={
  apiName:string;label:string;description?:string;fields:CustomFieldDefinition[];protected?:boolean;
};
export type SettingScope='organization'|'profile'|'user';
type SqlField={api_name:string;label:string;data_type:CustomFieldType;required?:boolean;max_length:number|null;sort_order:number};
type SqlRecord={id:string;record_key:string;master_label:string};
type SqlValue={
  field_api:string;data_type:CustomFieldType;value_text:string|null;value_number:string|null;
  value_boolean:boolean|null;value_date:string|null;value_datetime:Date|string|null;
};
type TypedValue={dataType:CustomFieldType;text:string|null;number:number|null;boolean:boolean|null;date:string|null;datetime:string|null};
const apiNamePattern=/^[A-Za-z][A-Za-z0-9_]*$/;
const languagePattern=/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const supportedTypes:readonly CustomFieldType[]=['text','number','boolean','date','datetime'];

function validateName(value:unknown):asserts value is string {
  if(typeof value!=='string'||!apiNamePattern.test(value))throw new Error('Invalid API name');
}
function validateText(value:unknown,maxLength=255):asserts value is string {
  if(typeof value!=='string'||!value.trim()||value.length>maxLength)throw new Error('Invalid label');
}
function validateDefinitionFields(fields:unknown):CustomFieldDefinition[] {
  if(!Array.isArray(fields)||fields.length>200)throw new Error('Invalid custom fields');
  const seen=new Set<string>();
  return fields.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid custom field');
    const field=value as Record<string,unknown>;
    validateName(field.apiName);
    validateText(field.label,255);
    if(!supportedTypes.includes(field.dataType as CustomFieldType)||seen.has(field.apiName.toLowerCase()))
      throw new Error('Invalid or duplicate custom field');
    seen.add(field.apiName.toLowerCase());
    if(field.required!==undefined&&typeof field.required!=='boolean')throw new Error('Invalid required setting');
    if(field.maxLength!==undefined&&(!Number.isSafeInteger(field.maxLength)||Number(field.maxLength)<1||Number(field.maxLength)>10000))
      throw new Error('Invalid custom field length');
    if(field.dataType!=='text'&&field.maxLength!==undefined)throw new Error('Length is supported only for text fields');
    return {apiName:field.apiName,label:field.label,dataType:field.dataType as CustomFieldType,
      ...(field.required===true?{required:true}:{}),
      ...(field.maxLength===undefined?{}:{maxLength:Number(field.maxLength)})};
  });
}
function validateFieldsInput(value:unknown):CustomFieldDefinition[] {
  return validateDefinitionFields(value);
}
function scalarForField(field:SqlField,value:unknown):TypedValue {
  const invalid=()=>{throw new Error(`Invalid value for field ${field.api_name}`);};
  if(field.data_type==='text'){
    if(typeof value!=='string'||value.length>(field.max_length??10000))return invalid();
    return {dataType:'text',text:value,number:null,boolean:null,date:null,datetime:null};
  }
  if(field.data_type==='number'){
    if(typeof value!=='number'||!Number.isFinite(value))return invalid();
    return {dataType:'number',text:null,number:value,boolean:null,date:null,datetime:null};
  }
  if(field.data_type==='boolean'){
    if(typeof value!=='boolean')return invalid();
    return {dataType:'boolean',text:null,number:null,boolean:value,date:null,datetime:null};
  }
  if(typeof value!=='string')return invalid();
  if(field.data_type==='date'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))
      ||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)return invalid();
    return {dataType:'date',text:null,number:null,boolean:null,date:value,datetime:null};
  }
  if(!/^\d{4}-\d{2}-\d{2}T/.test(value)||Number.isNaN(Date.parse(value)))return invalid();
  return {dataType:'datetime',text:null,number:null,boolean:null,date:null,datetime:value};
}
function plainValues(values:unknown):Record<string,unknown> {
  if(!values||typeof values!=='object'||Array.isArray(values)
    ||(Object.getPrototypeOf(values)!==Object.prototype&&Object.getPrototypeOf(values)!==null))
    throw new Error('Invalid custom values');
  const result=values as Record<string,unknown>;
  if(Object.keys(result).some(key=>['__proto__','prototype','constructor'].includes(key)))throw new Error('Invalid field name');
  return result;
}
function readValue(row:SqlValue):CustomScalar {
  if(row.data_type==='text')return row.value_text??'';
  if(row.data_type==='number')return Number(row.value_number);
  if(row.data_type==='boolean')return row.value_boolean===true;
  if(row.data_type==='date')return row.value_date??'';
  const value=row.value_datetime;
  return value instanceof Date?value.toISOString():String(value??'');
}
function definitionView(row:{api_name:string;label:string;description:string},fields:SqlField[]) {
  return {apiName:row.api_name,label:row.label,description:row.description,
    fields:fields.map(field=>({apiName:field.api_name,label:field.label,dataType:field.data_type,
      required:field.required===true,...(field.max_length===null?{}:{maxLength:field.max_length})}))};
}
async function loadFields(client:Pick<SqlExecutor,'query'>,table:'md_custom_metadata_fields'|'md_custom_setting_fields',
  ownerColumn:'type_api'|'setting_api',tenantId:string,apiName:string):Promise<SqlField[]> {
  const {rows}=await client.query<SqlField>(`SELECT api_name,label,data_type,required,max_length,sort_order
    FROM ${table} WHERE tenant_id=$1 AND ${ownerColumn}=$2 ORDER BY sort_order,api_name`,[tenantId,apiName]);
  return rows;
}
function validatedValues(fields:SqlField[],values:unknown,checkRequired:boolean) {
  const input=plainValues(values);
  const byApi=new Map(fields.map(field=>[field.api_name,field]));
  for(const key of Object.keys(input))if(!byApi.has(key))throw new Error(`Unknown field ${key}`);
  const parsed=new Map<string,TypedValue>();
  for(const field of fields){
    const value=input[field.api_name];
    if(value===undefined){
      if(checkRequired&&field.required)throw new Error(`Required field ${field.api_name}`);
      continue;
    }
    parsed.set(field.api_name,scalarForField(field,value));
  }
  if(checkRequired)for(const field of fields)if(field.required&&!parsed.has(field.api_name))
    throw new Error(`Required field ${field.api_name}`);
  return parsed;
}
async function insertTypedValue(client:Pick<PoolClient,'query'>,table:'md_custom_metadata_values'|'md_custom_setting_values',
  tenantId:string,ownerApi:string,recordId:string,fieldApi:string,value:TypedValue) {
  const ownerColumn=table==='md_custom_metadata_values'?'type_api':'setting_api';
  const entityColumn=table==='md_custom_metadata_values'?'record_id':'entry_id';
  await client.query(`INSERT INTO ${table}
    (tenant_id,${ownerColumn},${entityColumn},field_api,data_type,value_text,value_number,value_boolean,value_date,value_datetime)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [tenantId,ownerApi,recordId,fieldApi,value.dataType,value.text,value.number,value.boolean,value.date,value.datetime]);
}

/** Tenant-scoped custom labels, typed Custom Metadata records, and hierarchical Custom Settings. */
export class CustomMetadataService {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine) {}

  async listCustomLabels(tenantId:string,userId:string,language?:string) {
    await this.rbac.require(tenantId,userId,'CustomLabel','read');
    if(language!==undefined&&(typeof language!=='string'||language.length>35||!languagePattern.test(language)))
      throw new Error('Invalid language');
    const {rows}=await this.db.query<{api_name:string;language:string;label:string;value:string}>(
      `SELECT api_name,language,label,value FROM md_custom_labels WHERE tenant_id=$1
       AND ($2::text IS NULL OR language=$2) ORDER BY language,api_name`,[tenantId,language??null]);
    return rows.map(row=>({apiName:row.api_name,language:row.language,label:row.label,value:row.value}));
  }

  async getCustomLabel(tenantId:string,userId:string,apiName:string,language='en') {
    await this.rbac.require(tenantId,userId,'CustomLabel','read');
    validateName(apiName);
    if(typeof language!=='string'||language.length>35||!languagePattern.test(language))throw new Error('Invalid language');
    const {rows}=await this.db.query<{api_name:string;language:string;label:string;value:string}>(
      `SELECT api_name,language,label,value FROM md_custom_labels
       WHERE tenant_id=$1 AND api_name=$2 AND language=$3`,[tenantId,apiName,language]);
    if(!rows[0])throw new Error('Custom Label not found');
    return {apiName:rows[0].api_name,language:rows[0].language,label:rows[0].label,value:rows[0].value};
  }

  async saveCustomLabel(tenantId:string,userId:string,input:{apiName:string;language?:string;label:string;value:string;createOnly?:boolean}) {
    await this.rbac.require(tenantId,userId,'CustomLabel','manage');
    if(!input||typeof input!=='object')throw new Error('Invalid Custom Label');
    validateName(input.apiName);
    const language=input.language??'en';
    if(typeof language!=='string'||language.length>35||!languagePattern.test(language))throw new Error('Invalid language');
    validateText(input.label,255);
    if(typeof input.value!=='string'||input.value.length>4000)throw new Error('Invalid Custom Label value');
    const {rows}=await this.db.query<{api_name:string;language:string;label:string;value:string}>(
      `INSERT INTO md_custom_labels(tenant_id,api_name,language,label,value)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(tenant_id,api_name,language) DO UPDATE
       SET label=EXCLUDED.label,value=EXCLUDED.value,updated_at=now()
       WHERE NOT $6::boolean
       RETURNING api_name,language,label,value`,
      [tenantId,input.apiName,language,input.label.trim(),input.value,input.createOnly===true]);
    if(!rows[0])throw new Error('API Name already exists for this language');
    return {apiName:rows[0].api_name,language:rows[0].language,label:rows[0].label,value:rows[0].value};
  }

  async deleteCustomLabel(tenantId:string,userId:string,apiName:string,language='en') {
    await this.rbac.require(tenantId,userId,'CustomLabel','manage');
    validateName(apiName);
    const {rowCount}=await this.db.query(
      'DELETE FROM md_custom_labels WHERE tenant_id=$1 AND api_name=$2 AND language=$3',[tenantId,apiName,language]);
    if(!rowCount)throw new Error('Custom Label not found');
  }

  async listCustomMetadataTypes(tenantId:string,userId:string) {
    await this.rbac.require(tenantId,userId,'CustomMetadataType','read');
    const {rows}=await this.db.query<{api_name:string;label:string;description:string}>(
      'SELECT api_name,label,description FROM md_custom_metadata_types WHERE tenant_id=$1 ORDER BY api_name',[tenantId]);
    return Promise.all(rows.map(async row=>definitionView(row,
      await loadFields(this.db,'md_custom_metadata_fields','type_api',tenantId,row.api_name))));
  }

  async getCustomMetadataType(tenantId:string,userId:string,apiName:string) {
    await this.rbac.require(tenantId,userId,'CustomMetadataType','read');
    validateName(apiName);
    const {rows}=await this.db.query<{api_name:string;label:string;description:string}>(
      'SELECT api_name,label,description FROM md_custom_metadata_types WHERE tenant_id=$1 AND api_name=$2',[tenantId,apiName]);
    if(!rows[0])throw new Error('Custom Metadata Type not found');
    return definitionView(rows[0],await loadFields(this.db,'md_custom_metadata_fields','type_api',tenantId,apiName));
  }

  async createCustomMetadataType(tenantId:string,userId:string,input:CustomMetadataTypeInput) {
    await this.rbac.require(tenantId,userId,'CustomMetadataType','manage');
    if(!input||typeof input!=='object')throw new Error('Invalid Custom Metadata Type');
    validateName(input.apiName);
    validateText(input.label,255);
    if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>4000))
      throw new Error('Invalid description');
    const fields=validateFieldsInput(input.fields);
    return this.db.transaction(async client=>{
      await requireAvailableMetadataName(client,tenantId,'customMetadataType',input.apiName);
      const {rows}=await client.query<{api_name:string;label:string;description:string}>(
        `INSERT INTO md_custom_metadata_types(tenant_id,api_name,label,description)
         VALUES($1,$2,$3,$4) RETURNING api_name,label,description`,
        [tenantId,input.apiName,input.label.trim(),input.description??'']);
      for(let index=0;index<fields.length;index++){
        const field=fields[index] as CustomFieldDefinition&{sortOrder?:number};
        await client.query(`INSERT INTO md_custom_metadata_fields
          (tenant_id,type_api,api_name,label,data_type,required,max_length,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId,input.apiName,field.apiName,field.label.trim(),field.dataType,field.required===true,
          field.maxLength??null,index]);
      }
      return definitionView(rows[0],await loadFields(client,'md_custom_metadata_fields','type_api',tenantId,input.apiName));
    });
  }

  private async requireMetadataType(tenantId:string,userId:string,typeApi:string,action:'read'|'manage') {
    validateName(typeApi);
    await this.rbac.require(tenantId,userId,`CustomMetadata:${typeApi}`,action);
  }

  async saveCustomMetadataRecord(tenantId:string,userId:string,typeApi:string,
    input:{recordKey:string;masterLabel:string;values:Record<string,unknown>}) {
    await this.requireMetadataType(tenantId,userId,typeApi,'manage');
    if(!input||typeof input!=='object')throw new Error('Invalid Custom Metadata record');
    validateText(input.recordKey,255);
    validateText(input.masterLabel,255);
    return this.db.transaction(async client=>{
      const fields=await loadFields(client,'md_custom_metadata_fields','type_api',tenantId,typeApi);
      if(!fields.length) {
        const type=await client.query('SELECT 1 FROM md_custom_metadata_types WHERE tenant_id=$1 AND api_name=$2',[tenantId,typeApi]);
        if(!type.rowCount)throw new Error('Custom Metadata Type not found');
      }
      const values=validatedValues(fields,input.values,true);
      const {rows}=await client.query<SqlRecord>(`
        INSERT INTO md_custom_metadata_records(tenant_id,type_api,record_key,master_label)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(tenant_id,type_api,record_key) DO UPDATE
        SET master_label=EXCLUDED.master_label,updated_at=now()
        RETURNING id,record_key,master_label`,[tenantId,typeApi,input.recordKey,input.masterLabel.trim()]);
      const record=rows[0];
      await client.query('DELETE FROM md_custom_metadata_values WHERE tenant_id=$1 AND type_api=$2 AND record_id=$3',
        [tenantId,typeApi,record.id]);
      for(const [fieldApi,value] of values)
        await insertTypedValue(client,'md_custom_metadata_values',tenantId,typeApi,record.id,fieldApi,value);
      return this.readMetadataRecord(client,tenantId,typeApi,record);
    });
  }

  private   async readMetadataRecord(client:Pick<SqlExecutor,'query'>,tenantId:string,typeApi:string,record:SqlRecord) {
    const {rows}=await client.query<SqlValue>(`SELECT field_api,data_type,value_text,value_number::text,
      value_boolean,value_date::text,value_datetime FROM md_custom_metadata_values
      WHERE tenant_id=$1 AND type_api=$2 AND record_id=$3 ORDER BY field_api`,[tenantId,typeApi,record.id]);
    const values:Record<string,CustomScalar>={};
    for(const row of rows)values[row.field_api]=readValue(row);
    return {id:record.id,recordKey:record.record_key,masterLabel:record.master_label,values};
  }

  async getCustomMetadataRecord(tenantId:string,userId:string,typeApi:string,recordKey:string) {
    await this.requireMetadataType(tenantId,userId,typeApi,'read');
    validateText(recordKey,255);
    return this.db.transaction(async client=>{
      const {rows}=await client.query<SqlRecord>(
        `SELECT id,record_key,master_label FROM md_custom_metadata_records
         WHERE tenant_id=$1 AND type_api=$2 AND record_key=$3`,[tenantId,typeApi,recordKey]);
      if(!rows[0])throw new Error('Custom Metadata record not found');
      return this.readMetadataRecord(client,tenantId,typeApi,rows[0]);
    });
  }

  async listCustomMetadataRecords(tenantId:string,userId:string,typeApi:string) {
    await this.requireMetadataType(tenantId,userId,typeApi,'read');
    const {rows}=await this.db.query<SqlRecord>(
      `SELECT id,record_key,master_label FROM md_custom_metadata_records
       WHERE tenant_id=$1 AND type_api=$2 ORDER BY record_key LIMIT 1000`,[tenantId,typeApi]);
    return Promise.all(rows.map(record=>this.db.transaction(client=>
      this.readMetadataRecord(client,tenantId,typeApi,record))));
  }

  async deleteCustomMetadataRecord(tenantId:string,userId:string,typeApi:string,recordKey:string) {
    await this.requireMetadataType(tenantId,userId,typeApi,'manage');
    validateText(recordKey,255);
    const {rowCount}=await this.db.query(
      'DELETE FROM md_custom_metadata_records WHERE tenant_id=$1 AND type_api=$2 AND record_key=$3',
      [tenantId,typeApi,recordKey]);
    if(!rowCount)throw new Error('Custom Metadata record not found');
  }

  async listCustomSettings(tenantId:string,userId:string) {
    await this.rbac.require(tenantId,userId,'CustomSettingType','read');
    const {rows}=await this.db.query<{api_name:string;label:string;description:string;protection_mode:string}>(
      'SELECT api_name,label,description,protection_mode FROM md_custom_settings WHERE tenant_id=$1 ORDER BY api_name',[tenantId]);
    return Promise.all(rows.map(async row=>({...definitionView(row,
      await loadFields(this.db,'md_custom_setting_fields','setting_api',tenantId,row.api_name)),protected:row.protection_mode==='Protected'})));
  }

  async createCustomSetting(tenantId:string,userId:string,input:CustomSettingInput) {
    await this.rbac.require(tenantId,userId,'CustomSettingType','manage');
    if(!input||typeof input!=='object')throw new Error('Invalid Custom Setting');
    validateName(input.apiName);
    validateText(input.label,255);
    if(input.protected!==undefined&&typeof input.protected!=='boolean')throw new Error('Invalid setting protection');
    if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>4000))
      throw new Error('Invalid description');
    const fields=validateFieldsInput(input.fields);
    return this.db.transaction(async client=>{
      await requireAvailableMetadataName(client,tenantId,'customSetting',input.apiName);
      const {rows}=await client.query<{api_name:string;label:string;description:string}>(
        `INSERT INTO md_custom_settings(tenant_id,api_name,label,description,protection_mode)
         VALUES($1,$2,$3,$4,$5) RETURNING api_name,label,description`,
        [tenantId,input.apiName,input.label.trim(),input.description??'',input.protected?'Protected':'Public']);
      for(let index=0;index<fields.length;index++){
        const field=fields[index] as CustomFieldDefinition;
        await client.query(`INSERT INTO md_custom_setting_fields
          (tenant_id,setting_api,api_name,label,data_type,required,max_length,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId,input.apiName,field.apiName,field.label.trim(),field.dataType,
          field.required===true,field.maxLength??null,index]);
      }
      return {...definitionView(rows[0],await loadFields(client,'md_custom_setting_fields','setting_api',tenantId,input.apiName)),protected:input.protected===true};
    });
  }

  async writeCustomSettingValues(tenantId:string,userId:string,settingApi:string,scope:SettingScope,
    values:Record<string,unknown>,ownerId?:string) {
    validateName(settingApi);
    await this.rbac.require(tenantId,userId,`CustomSetting:${settingApi}`,'manage');
    if(!['organization','profile','user'].includes(scope))throw new Error('Invalid Custom Setting scope');
    if(scope==='organization'&&ownerId!==undefined)throw new Error('Organization settings have no owner');
    if(scope!=='organization'&&(typeof ownerId!=='string'||!ownerId))throw new Error('Setting owner is required');
    const input=plainValues(values);
    return this.db.transaction(async client=>{
      const fields=await loadFields(client,'md_custom_setting_fields','setting_api',tenantId,settingApi);
      const setting=await client.query('SELECT 1 FROM md_custom_settings WHERE tenant_id=$1 AND api_name=$2',
        [tenantId,settingApi]);
      if(!setting.rowCount)throw new Error('Custom Setting not found');
      const fieldMap=new Map(fields.map(field=>[field.api_name,field]));
      for(const key of Object.keys(input))if(!fieldMap.has(key))throw new Error(`Unknown field ${key}`);
      const fieldValues=new Map<string,TypedValue>();
      for(const [api,value] of Object.entries(input)){
        if(value!==null)fieldValues.set(api,scalarForField(fieldMap.get(api)!,value));
      }
      const ownerProfile=scope==='profile'?ownerId:null;
      const ownerUser=scope==='user'?ownerId:null;
      const entryResult=await client.query<{id:string}>(`
        INSERT INTO md_custom_setting_entries(tenant_id,setting_api,scope,profile_id,user_id)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING RETURNING id`,[tenantId,settingApi,scope,ownerProfile,ownerUser]);
      let entryId=entryResult.rows[0]?.id;
      if(!entryId){
        const conflict=scope==='organization'
          ?'scope=$3'
          :scope==='profile'?'scope=$3 AND profile_id=$4':'scope=$3 AND user_id=$5';
        const existing=await client.query<{id:string}>(
          `SELECT id FROM md_custom_setting_entries WHERE tenant_id=$1 AND setting_api=$2 AND ${conflict} FOR UPDATE`,
          [tenantId,settingApi,scope,ownerProfile,ownerUser]);
        entryId=existing.rows[0]?.id;
        if(!entryId)throw new Error('Custom Setting scope not found');
      }
      await client.query('UPDATE md_custom_setting_entries SET updated_at=now() WHERE tenant_id=$1 AND setting_api=$2 AND id=$3',
        [tenantId,settingApi,entryId]);
      for(const [api,value] of Object.entries(input)){
        if(value===null){
          await client.query(`DELETE FROM md_custom_setting_values
            WHERE tenant_id=$1 AND setting_api=$2 AND entry_id=$3 AND field_api=$4`,
          [tenantId,settingApi,entryId,api]);
        }else{
          const typed=fieldValues.get(api)!;
          await client.query(`INSERT INTO md_custom_setting_values
            (tenant_id,setting_api,entry_id,field_api,data_type,value_text,value_number,value_boolean,value_date,value_datetime)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT(tenant_id,setting_api,entry_id,field_api) DO UPDATE SET
             data_type=EXCLUDED.data_type,value_text=EXCLUDED.value_text,value_number=EXCLUDED.value_number,
             value_boolean=EXCLUDED.value_boolean,value_date=EXCLUDED.value_date,value_datetime=EXCLUDED.value_datetime`,
          [tenantId,settingApi,entryId,api,typed.dataType,typed.text,typed.number,typed.boolean,typed.date,typed.datetime]);
        }
      }
      return {settingApi,scope,ownerId:ownerId??null,fields:Object.fromEntries([...fieldValues].map(([key,value])=>
        [key,value.dataType==='text'?value.text:value.dataType==='number'?value.number:
          value.dataType==='boolean'?value.boolean:value.dataType==='date'?value.date:value.datetime]))};
    });
  }

  async getCustomSettingValues(tenantId:string,actorUserId:string,settingApi:string,targetUserId=actorUserId,
    scope?:SettingScope,ownerId?:string) {
    validateName(settingApi);
    await this.rbac.require(tenantId,actorUserId,`CustomSetting:${settingApi}`,'read');
    const setting=await this.db.query<{protection_mode:string}>(
      'SELECT protection_mode FROM md_custom_settings WHERE tenant_id=$1 AND api_name=$2',[tenantId,settingApi]);
    if(!setting.rowCount)throw new Error('Custom Setting not found');
    // Protected setting values are inaccessible to read-only actors, including
    // via inherited profile/user scopes. The OneEngine permission is authoritative.
    if(setting.rows[0]?.protection_mode==='Protected')
      await this.rbac.require(tenantId,actorUserId,`CustomSetting:${settingApi}`,'manage');
    if(scope!==undefined){
      await this.rbac.require(tenantId,actorUserId,`CustomSetting:${settingApi}`,'manage');
      if(!['organization','profile','user'].includes(scope))throw new Error('Invalid Custom Setting scope');
      if(scope==='organization'&&ownerId!==undefined)throw new Error('Organization settings have no owner');
      if(scope!=='organization'&&(typeof ownerId!=='string'||!ownerId))throw new Error('Setting owner is required');
      if(scope==='profile'){
        const profile=await this.db.query('SELECT 1 FROM md_profiles WHERE tenant_id=$1 AND id=$2',[tenantId,ownerId]);
        if(!profile.rowCount)throw new Error('Custom Setting profile not found');
      }else if(scope==='user'){
        const user=await this.db.query('SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$2',[tenantId,ownerId]);
        if(!user.rowCount)throw new Error('Custom Setting user not found');
      }
      const {rows:scopedRows}=await this.db.query<SqlValue>(`
        SELECT v.field_api,v.data_type,v.value_text,v.value_number::text,v.value_boolean,
          v.value_date::text,v.value_datetime
        FROM md_custom_setting_entries e JOIN md_custom_setting_values v
          ON v.tenant_id=e.tenant_id AND v.setting_api=e.setting_api AND v.entry_id=e.id
        WHERE e.tenant_id=$1 AND e.setting_api=$2 AND e.scope=$3
          AND (($3='organization' AND e.profile_id IS NULL AND e.user_id IS NULL)
            OR ($3='profile' AND e.profile_id=$4)
            OR ($3='user' AND e.user_id=$5))
        ORDER BY v.field_api`,[tenantId,settingApi,scope,scope==='profile'?ownerId:null,scope==='user'?ownerId:null]);
      const scopedValues:Record<string,CustomScalar>={};
      for(const row of scopedRows)scopedValues[row.field_api]=readValue(row);
      return {settingApi,scope,ownerId:ownerId??null,values:scopedValues};
    }
    if(targetUserId!==actorUserId)
      await this.rbac.require(tenantId,actorUserId,`CustomSetting:${settingApi}`,'manage');
    const user=await this.db.query(
      'SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$2',[tenantId,targetUserId]);
    if(!user.rowCount)throw new Error('Custom Setting user not found');
    const {rows}=await this.db.query<SqlValue>(`
      WITH profile AS (
        SELECT profile_id FROM md_user_profiles WHERE tenant_id=$1 AND user_id=$3
      ), candidates AS (
        SELECT v.field_api,v.data_type,v.value_text,v.value_number::text,v.value_boolean,v.value_date::text,
          v.value_datetime,e.scope,
          row_number() OVER(PARTITION BY v.field_api ORDER BY
            CASE e.scope WHEN 'user' THEN 1 WHEN 'profile' THEN 2 ELSE 3 END) AS choice
        FROM md_custom_setting_entries e
        JOIN md_custom_setting_values v ON v.tenant_id=e.tenant_id AND v.setting_api=e.setting_api AND v.entry_id=e.id
        WHERE e.tenant_id=$1 AND e.setting_api=$2 AND (
          e.scope='organization' OR
          (e.scope='profile' AND e.profile_id IN (SELECT profile_id FROM profile)) OR
          (e.scope='user' AND e.user_id=$3))
      )
      SELECT field_api,data_type,value_text,value_number,value_boolean,value_date,value_datetime
      FROM candidates WHERE choice=1 ORDER BY field_api`,
    [tenantId,settingApi,targetUserId]);
    const values:Record<string,CustomScalar>={};
    for(const row of rows)values[row.field_api]=readValue(row);
    return {settingApi,userId:targetUserId,values};
  }
}
