import type {PoolClient} from 'pg';
import {sanitizeRichText} from '../system-files/rich-text.js';
import {formatAutoNumberValue} from '../system-files/auto-number-format.js';
import {decryptFieldValue,encryptFieldValue} from '../system-files/encrypted-field.js';

type EncryptedValueVault={
  encryptOpaque(value:string):{ciphertext:Buffer;keyId:string};
  decryptOpaque(ciphertext:Buffer,keyId:string):string;
};
export type FieldTypeMigrationRuntime={
  encryptedValueVault?:EncryptedValueVault;
  evaluateFormula?:(client:PoolClient,tenantId:string,userId:string,objectApi:string,
    fieldApi:string,recordId:string)=>Promise<unknown>;
  recalculateRollup?:(client:PoolClient,tenantId:string,objectApi:string,fieldApi:string)=>Promise<void>;
};
export type FieldTypeTarget={
  dataType:string;
  maxLength:number|null;
  precision:number|null;
  scale:number|null;
  required:boolean;
  unique:boolean;
  externalId:boolean;
  caseSensitive:boolean;
  defaultValue:string|null;
  relatedObject?:string|null;
  globalValueSetApiName?:string|null;
  controllerFieldApiName?:string|null;
  relationshipType?:string|null;
  relationshipName?:string|null;
  childRelationshipName?:string|null;
  deleteBehavior?:string|null;
  allowReparenting?:boolean;
  picklistValues?:string[];
  picklistRestricted?:boolean;
  formulaExpression?:string|null;
  formulaReturnType?:string|null;
  autoNumberFormat?:string|null;
  rollup?:{
    childObject:string;relationshipField:string;operation:'COUNT'|'SUM'|'MIN'|'MAX';
    sourceField:string|null;filterLogic:'All'|'Any';
    filters:Array<{fieldApiName:string;operator:string;value:string}>;
  }|null;
  autoNumberCounterExists?:boolean;
  autoNumberNextValue?:number|null;
};
type FieldTypeSnapshot=FieldTypeTarget;

type StoredValue={
  record_id:string;
  value_text:string|null;
  value_number:string|null;
  value_boolean:boolean|null;
  value_date:string|null;
  value_datetime:Date|string|null;
  reference_record_id:string|null;
  geo_latitude:number|null;
  geo_longitude:number|null;
  address_street:string|null;
  address_city:string|null;
  address_state:string|null;
  address_postal_code:string|null;
  address_country:string|null;
  is_unique:boolean;
  case_sensitive:boolean;
};

type ConvertedValue={
  value_text:string|null;
  value_number:string|null;
  value_boolean:boolean|null;
  value_date:string|null;
  value_datetime:string|null;
  reference_record_id:string|null;
  geo_latitude:number|null;
  geo_longitude:number|null;
  address_street:string|null;
  address_city:string|null;
  address_state:string|null;
  address_postal_code:string|null;
  address_country:string|null;
};

const textTypes=new Set(['text','email','phone','url','textarea','longtext','richtext','picklist','multipicklist','autonumber']);
const numericTypes=new Set(['number','currency','percent','rollup']);
const fieldTypes=new Set([...textTypes,...numericTypes,'boolean','date','datetime','time','reference','address','geolocation','formula','encryptedtext']);

function internalType(dataType:string) {
  const compact=dataType.toLowerCase().replace(/\s+/g,'');
  const numeric=/^(number|currency|percent)\(\d+,\d+\)$/.exec(compact);
  const text=/^text\(\d+\)$/.exec(compact);
  const formula=/^formula\((text|number|currency|percent|date|datetime|time|checkbox)\)$/.exec(compact);
  if(numeric)return numeric[1];
  if(text)return 'text';
  if(formula)return 'formula';
  const types:Record<string,string>={
    text:'text',textarea:'textarea',longtextarea:'longtext',richtextarea:'richtext',
    email:'email',phone:'phone',url:'url',checkbox:'boolean',boolean:'boolean',
    date:'date','date/time':'datetime',datetime:'datetime',time:'time',
    number:'number',currency:'currency',percent:'percent',picklist:'picklist',
    'multi-selectpicklist':'multipicklist',multipicklist:'multipicklist',
    formula:'formula',address:'address',geolocation:'geolocation',autonumber:'autonumber',
    'auto number':'autonumber',encryptedtext:'encryptedtext','text(encrypted)':'encryptedtext'
  };
  if(/^(lookup|master-detail|hierarchical)\([a-z][a-z0-9_]*\)$/i.test(compact))return 'reference';
  return types[compact]??dataType;
}

export function fieldTypeSignature(dataType:string) {
  const compact=dataType.toLowerCase().replace(/\s+/g,'');
  const numeric=/^(number|currency|percent)\((\d+),(\d+)\)$/.exec(compact);
  const text=/^text\((\d+)\)$/.exec(compact);
  const type=internalType(dataType);
  const maxLength=text?Number(text[1]):type==='textarea'?255:
    ['longtext','richtext'].includes(type)?131072:type==='encryptedtext'?175:type==='phone'?40:null;
  return {dataType:type,maxLength,precision:numeric?Number(numeric[2]):null,
    scale:numeric?Number(numeric[3]):null};
}

function family(dataType:string) {
  if(textTypes.has(dataType))return 'text';
  if(numericTypes.has(dataType))return 'number';
  if(dataType==='boolean')return 'boolean';
  if(['date','datetime','time','reference','address','geolocation','formula','encryptedtext'].includes(dataType))
    return dataType;
  return null;
}

function formulaSourceType(returnType:string|null|undefined) {
  const type=(returnType??'').toLowerCase();
  if(['number','currency','percent'].includes(type))return 'number';
  if(type==='checkbox')return 'boolean';
  if(type==='datetime')return 'datetime';
  if(['text','date','time'].includes(type))return type;
  throw new Error('Formula return type cannot be materialized by a field migration');
}

function formulaStoredValue(returnType:string|null|undefined,result:unknown):StoredValue {
  const sourceType=formulaSourceType(returnType);
  const value:StoredValue={
    record_id:'',value_text:null,value_number:null,value_boolean:null,value_date:null,
    value_datetime:null,reference_record_id:null,geo_latitude:null,geo_longitude:null,
    address_street:null,address_city:null,address_state:null,address_postal_code:null,
    address_country:null,is_unique:false,case_sensitive:false
  };
  if(result===null||result===undefined)return value;
  if(sourceType==='number'){
    const number=typeof result==='number'?result:Number(result);
    if(!Number.isFinite(number))throw new Error('Formula did not return a finite number');
    value.value_text=String(number);value.value_number=String(number);
  }else if(sourceType==='boolean'){
    if(typeof result!=='boolean')throw new Error('Formula did not return a checkbox value');
    value.value_text=String(result);value.value_boolean=result;
  }else if(sourceType==='date'){
    const date=String(result);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Formula did not return a date value');
    value.value_text=date;value.value_date=date;
  }else if(sourceType==='datetime'){
    const date=new Date(String(result));
    if(Number.isNaN(date.getTime()))throw new Error('Formula did not return a date/time value');
    value.value_text=date.toISOString();value.value_datetime=date.toISOString();
  }else value.value_text=String(result);
  return value;
}

export function fieldTypeConversionSupported(source:string,target:string) {
  const sourceType=fieldTypeSignature(source).dataType;
  const targetType=fieldTypeSignature(target).dataType;
  const sourceFamily=family(sourceType);
  const targetFamily=family(targetType);
  if(!fieldTypes.has(sourceType)||!targetFamily||!sourceFamily)return false;
  if(sourceType==='formula'||targetType==='formula')return true;
  if(sourceType==='encryptedtext'||targetType==='encryptedtext')
    return sourceType==='encryptedtext'&&targetType==='encryptedtext'
      ||sourceType==='encryptedtext'&&textTypes.has(targetType)
      ||targetType==='encryptedtext'&&textTypes.has(sourceType);
  if(targetType==='rollup')return true;
  if(targetType==='autonumber')return true;
  if(sourceType==='rollup'&&targetType==='rollup')return true;
  if(['address','geolocation'].includes(sourceType)||['address','geolocation'].includes(targetType))
    return sourceType===targetType
      ||(textTypes.has(sourceType)&&['address','geolocation'].includes(targetType))
      ||(['address','geolocation'].includes(sourceType)&&textTypes.has(targetType));
  if(sourceType==='reference'||targetType==='reference')
    return (sourceType==='reference'&&(targetType==='reference'||textTypes.has(targetType)))
      ||(targetType==='reference'&&(sourceType==='reference'||textTypes.has(sourceType)));
  return sourceFamily===targetFamily
    ||(sourceFamily==='text'&&['number','boolean','date','datetime','time'].includes(targetFamily))
    ||(targetFamily==='text'&&['number','boolean','date','datetime','time'].includes(sourceFamily));
}

function numericText(value:string,target:FieldTypeTarget) {
  const match=/^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if(!match||target.precision===null||target.scale===null)
    throw new Error('Invalid numeric value for target field type');
  const integer=match[2].replace(/^0+(?=\d)/,'');
  let fraction=match[3]??'';
  if(fraction.length>target.scale){
    if(/[^0]/.test(fraction.slice(target.scale)))
      throw new Error('Numeric value exceeds target scale');
    fraction=fraction.slice(0,target.scale);
  }
  const integerDigits=integer==='0'?0:integer.length;
  if(integerDigits>target.precision-target.scale
    ||integerDigits+fraction.length>target.precision)
    throw new Error('Numeric value exceeds target precision');
  fraction=fraction.replace(/0+$/,'');
  const sign=match[1]==='-'&&(/[1-9]/.test(integer)||/[1-9]/.test(fraction))?'-':'';
  return sign+integer+(fraction?'.'+fraction:'');
}

function temporalText(sourceType:string,value:StoredValue):string {
  if(sourceType==='date'){
    const date=value.value_date??value.value_text;
    if(typeof date!=='string'||!/^(\d{4})-(\d{2})-(\d{2})$/.test(date))
      throw new Error('Invalid date value');
    const parsed=new Date(`${date}T00:00:00Z`);
    if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)
      throw new Error('Invalid date value');
    return date;
  }
  if(sourceType==='datetime'){
    const raw=value.value_datetime??value.value_text;
    if(raw===null)throw new Error('Invalid date/time value');
    const date=new Date(raw);
    if(Number.isNaN(date.getTime()))throw new Error('Invalid date/time value');
    return date.toISOString();
  }
  const time=value.value_text;
  if(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(time))
    throw new Error('Invalid time value');
  return time;
}

function sourceText(sourceType:string,value:StoredValue):string {
  if(sourceType==='reference'){
    if(!value.reference_record_id)throw new Error('Missing source relationship value');
    return value.reference_record_id;
  }
  if(sourceType==='geolocation'){
    if(value.geo_latitude===null||value.geo_longitude===null)
      throw new Error('Missing source geolocation value');
    return `${value.geo_latitude},${value.geo_longitude}`;
  }
  if(sourceType==='address'){
    const address={street:value.address_street,city:value.address_city,state:value.address_state,
      postalCode:value.address_postal_code,country:value.address_country};
    return JSON.stringify(Object.fromEntries(Object.entries(address).filter(([,item])=>item!==null)));
  }
  if(textTypes.has(sourceType)){
    if(value.value_text===null)throw new Error('Missing source field value');
    return value.value_text;
  }
  if(numericTypes.has(sourceType)){
    const number=value.value_number??value.value_text;
    if(number===null)throw new Error('Missing source field value');
    return number;
  }
  if(sourceType==='boolean'){
    const boolean=value.value_boolean;
    if(boolean===null&&value.value_text===null)throw new Error('Missing source field value');
    return String(boolean??value.value_text);
  }
  return temporalText(sourceType,value);
}

async function persistMigrationConfig(client:PoolClient,tenantId:string,migrationId:string,
  side:'from'|'to',config:FieldTypeTarget) {
  const rollup=config.rollup??null;
  await client.query(`INSERT INTO md_field_type_migration_config
    (tenant_id,migration_id,side,related_object,global_value_set_api,controller_field_api,relationship_type,relationship_name,
     child_relationship_name,delete_behavior,allow_reparenting,picklist_restricted,
     auto_number_format,formula_expression,formula_return_type,rollup_child_object,
     rollup_relationship_field,rollup_operation,rollup_source_field,rollup_filter_logic)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
  [tenantId,migrationId,side,config.relatedObject??null,config.globalValueSetApiName??null,
    config.controllerFieldApiName??null,config.relationshipType??null,config.relationshipName??null,
    config.childRelationshipName??null,config.deleteBehavior??null,config.allowReparenting??false,
    config.picklistRestricted??true,config.autoNumberFormat??null,config.formulaExpression??null,
    config.formulaReturnType??null,rollup?.childObject??null,rollup?.relationshipField??null,
    rollup?.operation??null,rollup?.sourceField??null,rollup?.filterLogic??null]);
  for(const [sortOrder,value] of (config.picklistValues??[]).entries())
    await client.query(`INSERT INTO md_field_type_migration_picklist_values
      (tenant_id,migration_id,side,value,sort_order) VALUES($1,$2,$3,$4,$5)`,
    [tenantId,migrationId,side,value,sortOrder]);
  for(const [sortOrder,filter] of (rollup?.filters??[]).entries())
    await client.query(`INSERT INTO md_field_type_migration_rollup_filters
      (tenant_id,migration_id,side,filter_field_api,operator,value_text,sort_order)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [tenantId,migrationId,side,filter.fieldApiName,filter.operator,filter.value,sortOrder]);
}

export function convertFieldValue(sourceType:string,value:StoredValue,target:FieldTypeTarget):ConvertedValue {
  const sourceFamily=family(sourceType);
  const targetFamily=family(target.dataType);
  if(!fieldTypes.has(sourceType)||!targetFamily||!sourceFamily)
    throw new Error('Field datatype migration is not supported for this field type');
  if(sourceFamily!==targetFamily&&sourceType!=='text'&&target.dataType!=='text'
    &&!(sourceFamily==='text'&&['number','boolean','date','datetime','time'].includes(targetFamily))
    &&!(targetFamily==='text'&&['number','boolean','date','datetime','time','reference','address','geolocation'].includes(sourceFamily))
    &&!(target.dataType==='reference'&&sourceFamily==='text')
    &&!(target.dataType==='address'&&sourceFamily==='text')
    &&!(target.dataType==='geolocation'&&sourceFamily==='text'))
    throw new Error('Field datatype conversion is not supported without data loss');
  const empty:ConvertedValue={value_text:null,value_number:null,value_boolean:null,value_date:null,
    value_datetime:null,reference_record_id:null,geo_latitude:null,geo_longitude:null,
    address_street:null,address_city:null,address_state:null,address_postal_code:null,address_country:null};
  if(target.dataType==='formula')
    throw new Error('Formula migration requires a validated formula definition and calculated values');
  const raw=sourceText(sourceType,value);
  if(target.dataType==='address'){
    if(!textTypes.has(sourceType)&&sourceType!=='address')
      throw new Error('Address migration requires a structured address value');
    let address:Record<string,unknown>;
    try{address=JSON.parse(raw) as Record<string,unknown>;}
    catch{throw new Error('Address migration requires a valid structured address value');}
    const limits:Record<string,number>={street:255,city:40,state:80,postalCode:20,country:80};
    const components:Record<string,string|null>={};
    const keys:Record<string,string>={postalCode:'postalCode',street:'street',city:'city',state:'state',country:'country'};
    for(const [key,limit] of Object.entries(limits)){
      const item=address[key];
      if(item!==undefined&&item!==null&&(typeof item!=='string'||item.length>limit))
        throw new Error('Invalid address component: '+key);
      components[key]=typeof item==='string'&&item.trim()?item.trim():null;
    }
    if(Object.keys(address).some(key=>!Object.hasOwn(keys,key)))
      throw new Error('Invalid address component');
    return {...empty,value_text:null,address_street:components.street,address_city:components.city,
      address_state:components.state,address_postal_code:components.postalCode,address_country:components.country};
  }
  if(target.dataType==='geolocation'){
    if(!textTypes.has(sourceType)&&sourceType!=='geolocation')
      throw new Error('Geolocation migration requires latitude,longitude text');
    const [latitudeText,longitudeText,...rest]=raw.split(',');
    const latitude=Number(latitudeText),longitude=Number(longitudeText);
    if(rest.length||!latitudeText?.trim()||!longitudeText?.trim()
      ||!Number.isFinite(latitude)||!Number.isFinite(longitude)
      ||latitude< -90||latitude>90||longitude< -180||longitude>180)
      throw new Error('Invalid geolocation value');
    return {...empty,value_text:null,geo_latitude:latitude,geo_longitude:longitude};
  }
  if(target.dataType==='reference'){
    if(!textTypes.has(sourceType)&&sourceType!=='reference')
      throw new Error('Relationship migration requires a record ID value');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw))
      throw new Error('Invalid relationship record ID');
    return {...empty,value_text:null,reference_record_id:raw};
  }
  if(target.dataType==='multipicklist'){
    if(sourceType!=='picklist'&&sourceType!=='multipicklist'&&!textTypes.has(sourceType))
      throw new Error('Multi-select Picklist migration requires text or picklist values');
    if(raw==='')return {...empty,value_text:null};
    const selected=raw.split(';');
    if(selected.some(item=>!item)||new Set(selected).size!==selected.length)
      throw new Error('Invalid multi-select picklist value');
    if(target.picklistRestricted!==false&&target.picklistValues
      &&selected.some(item=>!target.picklistValues!.includes(item)))
      throw new Error('Existing value is not in the target picklist');
    if(target.maxLength!==null&&raw.length>target.maxLength)
      throw new Error('Existing value exceeds target text length');
    return {...empty,value_text:raw};
  }
  if(target.dataType==='picklist'){
    if(sourceType==='multipicklist'&&raw.includes(';'))
      throw new Error('Multiple selected values cannot be converted to a single-select picklist');
    if(raw!==''&&target.picklistRestricted!==false&&target.picklistValues
      &&!target.picklistValues.includes(raw))
      throw new Error('Existing value is not in the target picklist');
  }
  if(targetFamily==='text'){
    if(target.maxLength!==null&&raw.length>target.maxLength)
      throw new Error('Existing value exceeds target text length');
    if(target.dataType==='email'&&raw!==''&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))
      throw new Error('Existing value is not a valid email address');
    if(target.dataType==='phone'&&raw!==''&&(raw.length>40||!/\d/.test(raw)
      ||!/^\+?[0-9().\-\s]*(?:\s*(?:x|ext\.?|#)\s*\d+)?$/i.test(raw)))
      throw new Error('Existing value is not a valid phone number');
    if(target.dataType==='url'&&raw!==''&&!/^https?:\/\/[^\s]+$/i.test(raw))
      throw new Error('Existing value is not a valid URL');
    return {...empty,value_text:target.dataType==='richtext'?sanitizeRichText(raw):raw};
  }
  if(targetFamily==='number'){
    const normalized=numericText(raw,target);
    return {...empty,value_text:normalized,value_number:normalized};
  }
  if(targetFamily==='boolean'){
    if(raw!=='true'&&raw!=='false')throw new Error('Existing value is not true or false');
    return {...empty,value_text:raw,value_boolean:raw==='true'};
  }
  if(targetFamily==='date'){
    if(sourceFamily!=='date'&&sourceFamily!=='text')
      throw new Error('Only ISO date text can be converted to Date');
    const date=temporalText('date',value);
    return {...empty,value_text:date,value_date:date};
  }
  if(targetFamily==='datetime'){
    if(sourceFamily!=='datetime'&&sourceFamily!=='text')
      throw new Error('Only ISO date/time text can be converted to Date/Time');
    const date=temporalText('datetime',value);
    return {...empty,value_text:date,value_datetime:date};
  }
  const time=temporalText('time',value);
  return {...empty,value_text:time};
}

export async function applyFieldTypeMigration(
  client:PoolClient,tenantId:string,objectApi:string,fieldApi:string,actorUserId:string|null,
  expected:FieldTypeSnapshot,target:FieldTypeTarget,runtime:FieldTypeMigrationRuntime={}
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [`${tenantId}:${objectApi}`]);
  const locked=await client.query<{
    data_type:string;max_length:number|null;precision:number|null;scale:number|null;required:boolean;
    is_unique:boolean;external_id:boolean;case_sensitive:boolean;default_value:string|null
  }>(`SELECT data_type,max_length,precision,scale,required,is_unique,external_id,case_sensitive,default_value
      FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
        AND deleted_at IS NULL FOR UPDATE`,[tenantId,objectApi,fieldApi]);
  const previous=locked.rows[0];
  if(!previous)throw new Error('Field not found');
  if(previous.data_type!==expected.dataType||previous.max_length!==expected.maxLength
    ||previous.precision!==expected.precision||previous.scale!==expected.scale
    ||previous.required!==expected.required||previous.is_unique!==expected.unique
    ||previous.external_id!==expected.externalId||previous.case_sensitive!==expected.caseSensitive
    ||previous.default_value!==expected.defaultValue)
    throw new Error('Field definition changed concurrently');
  if(!fieldTypeConversionSupported(previous.data_type,target.dataType))
    throw new Error('Field datatype migration is not supported for this field type');
  if(target.defaultValue!==null&&target.dataType!=='formula'
    &&target.dataType!=='autonumber'&&target.dataType!=='rollup'){
    convertFieldValue(previous.data_type,{
      record_id:'',value_text:target.defaultValue,value_number:null,value_boolean:null,
      value_date:null,value_datetime:null,reference_record_id:null,geo_latitude:null,
      geo_longitude:null,address_street:null,address_city:null,address_state:null,
      address_postal_code:null,address_country:null,is_unique:false,case_sensitive:false
    },target);
  }
  const dependencies=await client.query(`SELECT 1 FROM md_field_definitions f
    WHERE f.tenant_id=$1 AND (
      (f.rollup_child_object=$2 AND f.rollup_source_field=$3)
      OR position('@'||$2||'.'||$3 in COALESCE(f.formula_expression,''))>0)
    UNION ALL
    SELECT 1 FROM md_field_dependencies d
      WHERE d.tenant_id=$1 AND d.object_api=$2
        AND (d.controller_field_api=$3 OR d.field_api=$3)
    UNION ALL
    SELECT 1 FROM md_field_rollup_filters rf
      WHERE rf.tenant_id=$1 AND rf.child_object=$2 AND rf.filter_field_api=$3
    LIMIT 1`,[tenantId,objectApi,fieldApi]);
  if(dependencies.rowCount)
    throw new Error('Field type is used by formulas, roll-ups or dependent picklists');
  const requiredValueMissing=target.dataType==='reference'?'v.reference_record_id IS NULL':
    target.dataType==='geolocation'?'v.geo_latitude IS NULL OR v.geo_longitude IS NULL':
      target.dataType==='address'?'COALESCE(v.address_street,v.address_city,v.address_state,v.address_postal_code,v.address_country) IS NULL'
        :'v.value_text IS NULL';
  const missing=target.required&&expected.dataType!=='formula'
    &&!['autonumber','rollup'].includes(target.dataType)?await client.query(`SELECT 1 FROM md_records r
    LEFT JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.field_api=$3
    WHERE r.tenant_id=$1 AND r.object_api=$2 AND (v.record_id IS NULL OR ${requiredValueMissing}) LIMIT 1`,
  [tenantId,objectApi,fieldApi]):{rowCount:0};
  if(missing.rowCount)throw new Error('Required field migration cannot proceed while records have no value');
  const inserted=await client.query<{id:string}>(`INSERT INTO md_field_type_migrations
    (tenant_id,object_api,field_api,actor_user_id,from_data_type,to_data_type,
     from_max_length,from_precision,from_scale,from_required,from_unique,from_external_id,
     from_case_sensitive,from_default_value,to_max_length,to_precision,to_scale,to_required,
     to_unique,to_external_id,to_case_sensitive,to_default_value)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    RETURNING id`,[tenantId,objectApi,fieldApi,actorUserId,previous.data_type,target.dataType,
    previous.max_length,previous.precision,previous.scale,previous.required,previous.is_unique,
    previous.external_id,previous.case_sensitive,previous.default_value,target.maxLength,
    target.precision,target.scale,target.required,target.unique,target.externalId,
    target.caseSensitive,target.defaultValue]);
  const migrationId=inserted.rows[0].id;
  const priorCounter=await client.query<{next_value:string}>(`SELECT next_value::text AS next_value
    FROM md_auto_number_counters WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
  [tenantId,objectApi,fieldApi]);
  const priorCounterExists=priorCounter.rows.length>0;
  const priorCounterValue=priorCounterExists?Number(priorCounter.rows[0].next_value):1;
  if(!Number.isSafeInteger(priorCounterValue)||priorCounterValue<1)
    throw new Error('Auto Number counter is outside the supported range');
  expected.autoNumberCounterExists=previous.data_type==='autonumber'&&priorCounterExists;
  expected.autoNumberNextValue=priorCounterExists?priorCounterValue:null;
  target.autoNumberCounterExists=false;
  target.autoNumberNextValue=null;
  await persistMigrationConfig(client,tenantId,migrationId,'from',expected);
  await persistMigrationConfig(client,tenantId,migrationId,'to',target);
  await client.query(`UPDATE md_field_type_migration_config
    SET auto_number_counter_exists=$3,auto_number_next_value=$4
    WHERE tenant_id=$1 AND migration_id=$2 AND side='from'`,
  [tenantId,migrationId,expected.autoNumberCounterExists,
    expected.autoNumberCounterExists?priorCounterValue:null]);
  const duplicateValues=new Set<string>();
  let lastRecordId:string|null=null;
  let count=0;
  const sourceFormula=expected.dataType==='formula'&&target.dataType!=='formula';
  const sourceFormulaType=sourceFormula?formulaSourceType(expected.formulaReturnType):null;
  const targetCounterStart=target.dataType==='autonumber'
    ?previous.data_type==='autonumber'&&priorCounterExists?priorCounterValue:1:0;
  const targetAutoFormat=target.autoNumberFormat??'{000000}';
  const migrationYear=new Date().getUTCFullYear();
  while(true){
    const batch:{rows:Array<StoredValue&{field_exists:boolean}>}=await client.query<StoredValue&{field_exists:boolean}>(`
      SELECT r.id AS record_id,v.record_id IS NOT NULL AS field_exists,v.value_text,
        v.value_number::text AS value_number,v.value_boolean,v.value_date::text AS value_date,
        v.value_datetime,v.reference_record_id,v.geo_latitude,v.geo_longitude,v.address_street,
        v.address_city,v.address_state,v.address_postal_code,v.address_country,
        COALESCE(v.is_unique,false) AS is_unique,COALESCE(v.case_sensitive,false) AS case_sensitive
      FROM md_records r LEFT JOIN md_record_values v
        ON v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.object_api=r.object_api
          AND v.field_api=$3
      WHERE r.tenant_id=$1 AND r.object_api=$2 AND ($4::uuid IS NULL OR r.id>$4::uuid)
      ORDER BY r.id LIMIT 500`,
    [tenantId,objectApi,fieldApi,lastRecordId]);
    if(!batch.rows.length)break;
    for(const row of batch.rows){
      let sourceValue:StoredValue=row;
      let sourceType=fieldTypeSignature(previous.data_type).dataType;
      if(sourceFormula){
        if(!runtime.evaluateFormula||!actorUserId)
          throw new Error('Formula migration requires the shared formula runtime and an authorized actor');
        sourceType=sourceFormulaType!;
        sourceValue=formulaStoredValue(expected.formulaReturnType,
          await runtime.evaluateFormula(client,tenantId,actorUserId,objectApi,fieldApi,row.record_id));
      }else if(sourceType==='encryptedtext'&&row.value_text!==null){
        if(!runtime.encryptedValueVault)throw new Error('Encrypted field vault is unavailable');
        sourceValue={...row,value_text:decryptFieldValue(runtime.encryptedValueVault,
          tenantId,objectApi,fieldApi,row.value_text)};
        sourceType='text';
      }
      const hasValue=sourceValue.value_text!=null||sourceValue.value_number!=null
        ||sourceValue.value_boolean!=null||sourceValue.value_date!=null
        ||sourceValue.value_datetime!=null||sourceValue.reference_record_id!=null
        ||sourceValue.geo_latitude!=null||sourceValue.geo_longitude!=null
        ||sourceValue.address_street!=null||sourceValue.address_city!=null
        ||sourceValue.address_state!=null||sourceValue.address_postal_code!=null
        ||sourceValue.address_country!=null;
      let converted=target.dataType==='formula'?{
        value_text:row.value_text,value_number:row.value_number,value_boolean:row.value_boolean,
        value_date:row.value_date,value_datetime:row.value_datetime instanceof Date
          ?row.value_datetime.toISOString():row.value_datetime,
        reference_record_id:row.reference_record_id,geo_latitude:row.geo_latitude,
        geo_longitude:row.geo_longitude,address_street:row.address_street,
        address_city:row.address_city,address_state:row.address_state,
        address_postal_code:row.address_postal_code,address_country:row.address_country
      }:target.dataType==='autonumber'?{
        value_text:formatAutoNumberValue(targetAutoFormat,targetCounterStart+count,
          migrationYear),value_number:null,value_boolean:null,value_date:null,
        value_datetime:null,reference_record_id:null,geo_latitude:null,geo_longitude:null,
        address_street:null,address_city:null,address_state:null,address_postal_code:null,
        address_country:null
      }:target.dataType==='rollup'?{
        value_text:null,value_number:null,value_boolean:null,value_date:null,value_datetime:null,
        reference_record_id:null,geo_latitude:null,geo_longitude:null,address_street:null,
        address_city:null,address_state:null,address_postal_code:null,address_country:null
      }:hasValue?convertFieldValue(sourceType,sourceValue,
        target.dataType==='encryptedtext'?{...target,dataType:'text'}:target):{
          value_text:null,value_number:null,value_boolean:null,value_date:null,value_datetime:null,
          reference_record_id:null,geo_latitude:null,geo_longitude:null,address_street:null,
          address_city:null,address_state:null,address_postal_code:null,address_country:null
        };
      if(target.dataType==='encryptedtext'&&converted.value_text!==null){
        if(!runtime.encryptedValueVault)throw new Error('Encrypted field vault is unavailable');
        converted={...converted,value_text:encryptFieldValue(runtime.encryptedValueVault,
          tenantId,objectApi,fieldApi,converted.value_text)};
      }
      const afterExists=target.dataType==='formula'?row.field_exists:
        row.field_exists||target.dataType==='autonumber'||target.dataType==='rollup'
          ||Object.values(converted).some(item=>item!==null);
      if(target.required&&(!afterExists||(
        target.dataType==='reference'?converted.reference_record_id===null:
        target.dataType==='address'?converted.address_street===null&&converted.address_city===null
          &&converted.address_state===null&&converted.address_postal_code===null
          &&converted.address_country===null:converted.value_text===null)))
        throw new Error('Required field migration cannot proceed while records have no value');
      if(target.dataType==='encryptedtext'&&converted.value_text!==null
        &&converted.value_text.length>1000)
        throw new Error('Encrypted field value exceeds the storage envelope limit');
      if(converted.reference_record_id){
        if(!target.relatedObject)throw new Error('Relationship target object is required');
        const match=await client.query(`SELECT 1 FROM md_records
          WHERE tenant_id=$1 AND object_api=$2 AND id=$3 LIMIT 1`,
        [tenantId,target.relatedObject,converted.reference_record_id]);
        if(!match.rowCount)throw new Error('Relationship value does not reference a record in the target object');
      }
      if(target.dataType==='picklist'&&converted.value_text!==null&&converted.value_text!==''
        &&target.picklistRestricted!==false
        &&target.picklistValues&&!target.picklistValues.includes(converted.value_text??''))
        throw new Error('Existing value is not in the target picklist');
      if(target.dataType==='multipicklist'&&converted.value_text!==null&&converted.value_text!==''
        &&target.picklistRestricted!==false
        &&target.picklistValues&&(converted.value_text??'').split(';')
          .some(item=>!target.picklistValues!.includes(item)))
        throw new Error('Existing value is not in the target picklist');
      if(converted.value_text!==null&&(target.unique)){
        const key=target.caseSensitive?converted.value_text:converted.value_text.toLowerCase();
        if(duplicateValues.has(key))throw new Error('Converted values conflict with the target unique setting');
        duplicateValues.add(key);
      }
      const snapshotEncrypted=target.dataType==='encryptedtext'
        &&previous.data_type!=='encryptedtext'&&row.value_text!==null;
      let beforeText=row.value_text;
      if(snapshotEncrypted){
        if(!runtime.encryptedValueVault)throw new Error('Encrypted field vault is unavailable');
        beforeText=encryptFieldValue(runtime.encryptedValueVault,tenantId,objectApi,fieldApi,row.value_text!);
      }
      await client.query(`INSERT INTO md_field_type_migration_values
        (tenant_id,migration_id,record_id,object_api,before_value_text,before_value_number,
         before_value_boolean,before_value_date,before_value_datetime,before_is_unique,before_case_sensitive,
         after_value_text,after_value_number,after_value_boolean,after_value_date,after_value_datetime,
         before_reference_record_id,before_geo_latitude,before_geo_longitude,before_address_street,
         before_address_city,before_address_state,before_address_postal_code,before_address_country,
         after_reference_record_id,after_geo_latitude,after_geo_longitude,after_address_street,
         after_address_city,after_address_state,after_address_postal_code,after_address_country,
         before_value_exists,before_snapshot_encrypted,after_value_exists)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
      [tenantId,migrationId,row.record_id,objectApi,beforeText,row.value_number,
        row.value_boolean,row.value_date,row.value_datetime,row.is_unique,row.case_sensitive,
        converted.value_text,converted.value_number,converted.value_boolean,converted.value_date,
        converted.value_datetime,row.reference_record_id,row.geo_latitude,row.geo_longitude,
        row.address_street,row.address_city,row.address_state,row.address_postal_code,
        row.address_country,converted.reference_record_id,converted.geo_latitude,converted.geo_longitude,
        converted.address_street,converted.address_city,converted.address_state,
        converted.address_postal_code,converted.address_country,row.field_exists,
        snapshotEncrypted,
        afterExists]);
      lastRecordId=row.record_id;
      count++;
    }
  }
  // Switch field metadata only after validating/snapshotting the old values, but
  // before updating value_text: the typed projection trigger consults the live
  // field type and would otherwise erase migrated numeric/date projections.
  await client.query(`UPDATE md_field_definitions SET data_type=$4,max_length=$5,precision=$6,scale=$7,
      required=$8,is_unique=$9,external_id=$10,case_sensitive=$11,default_value=$12
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3`,
  [tenantId,objectApi,fieldApi,target.dataType,target.maxLength,target.precision,target.scale,
    target.required,target.unique,target.externalId,target.caseSensitive,target.defaultValue]);
  if(target.dataType!=='formula')await client.query(`UPDATE md_record_values v SET value_text=m.after_value_text,
      value_number=m.after_value_number,value_boolean=m.after_value_boolean,
      value_date=m.after_value_date,value_datetime=m.after_value_datetime,
      reference_record_id=m.after_reference_record_id,geo_latitude=m.after_geo_latitude,
      geo_longitude=m.after_geo_longitude,address_street=m.after_address_street,
      address_city=m.after_address_city,address_state=m.after_address_state,
      address_postal_code=m.after_address_postal_code,address_country=m.after_address_country,
      is_unique=$3,case_sensitive=$4
    FROM md_field_type_migration_values m WHERE m.tenant_id=$1 AND m.migration_id=$2
      AND v.tenant_id=m.tenant_id AND v.record_id=m.record_id AND v.object_api=m.object_api
      AND v.field_api=$5`,
  [tenantId,migrationId,target.unique,target.caseSensitive,fieldApi]);
  if(target.dataType!=='formula')await client.query(`INSERT INTO md_record_values
      (tenant_id,record_id,object_api,field_api,value_text,value_number,value_boolean,value_date,
       value_datetime,reference_record_id,geo_latitude,geo_longitude,address_street,address_city,
       address_state,address_postal_code,address_country,is_unique,case_sensitive)
    SELECT m.tenant_id,m.record_id,m.object_api,$3,m.after_value_text,m.after_value_number,
      m.after_value_boolean,m.after_value_date,m.after_value_datetime,m.after_reference_record_id,
      m.after_geo_latitude,m.after_geo_longitude,m.after_address_street,m.after_address_city,
      m.after_address_state,m.after_address_postal_code,m.after_address_country,$4,$5
    FROM md_field_type_migration_values m
    WHERE m.tenant_id=$1 AND m.migration_id=$2 AND m.after_value_exists
      AND NOT EXISTS(SELECT 1 FROM md_record_values v WHERE v.tenant_id=m.tenant_id
        AND v.record_id=m.record_id AND v.object_api=m.object_api AND v.field_api=$3)
    ON CONFLICT(tenant_id,record_id,field_api) DO NOTHING`,
  [tenantId,migrationId,fieldApi,target.unique,target.caseSensitive]);
  await client.query(`DELETE FROM md_record_multi_values
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
  if(target.dataType==='multipicklist')await client.query(`INSERT INTO md_record_multi_values
    (tenant_id,record_id,object_api,field_api,value,sort_order)
    SELECT v.tenant_id,v.record_id,v.object_api,v.field_api,choice.value,(choice.ordinality-1)::integer
    FROM md_record_values v
    CROSS JOIN LATERAL unnest(string_to_array(v.value_text,';')) WITH ORDINALITY choice(value,ordinality)
    WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.field_api=$3 AND v.value_text IS NOT NULL`,
  [tenantId,objectApi,fieldApi]);
  if(target.dataType==='autonumber'){
    const nextValue=targetCounterStart+count;
    if(!Number.isSafeInteger(nextValue)||nextValue<1)
      throw new Error('Auto Number sequence exceeds the supported range');
    await client.query(`INSERT INTO md_auto_number_counters
      (tenant_id,object_api,field_api,next_value) VALUES($1,$2,$3,$4)
      ON CONFLICT(tenant_id,object_api,field_api) DO UPDATE SET next_value=EXCLUDED.next_value`,
    [tenantId,objectApi,fieldApi,nextValue]);
    await client.query(`UPDATE md_field_type_migration_config
      SET auto_number_counter_exists=true,auto_number_next_value=$3
      WHERE tenant_id=$1 AND migration_id=$2 AND side='to'`,
    [tenantId,migrationId,nextValue]);
  }else if(previous.data_type==='autonumber'){
    await client.query(`DELETE FROM md_auto_number_counters
      WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
  }
  await client.query('UPDATE md_field_type_migrations SET records_migrated=$3 WHERE tenant_id=$1 AND id=$2',
    [tenantId,migrationId,count]);
  return migrationId;
}

export async function rollbackFieldTypeMigration(
  client:PoolClient,tenantId:string,objectApi:string,fieldApi:string,migrationId:string,
  runtime:FieldTypeMigrationRuntime={}
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [`${tenantId}:${objectApi}`]);
  const result=await client.query<{
    status:string;from_data_type:string;to_data_type:string;
    from_max_length:number|null;from_precision:number|null;from_scale:number|null;from_required:boolean;
    from_unique:boolean;from_external_id:boolean;from_case_sensitive:boolean;from_default_value:string|null;
    to_max_length:number|null;to_precision:number|null;to_scale:number|null;to_required:boolean;
    to_unique:boolean;to_external_id:boolean;to_case_sensitive:boolean;to_default_value:string|null;
    current_data_type:string;current_max_length:number|null;current_precision:number|null;
    current_scale:number|null;current_required:boolean;current_unique:boolean;
    current_external_id:boolean;current_case_sensitive:boolean;current_default_value:string|null;
  }>(`SELECT m.status,m.from_data_type,m.to_data_type,m.from_max_length,m.from_precision,m.from_scale,
      m.from_required,m.from_unique,m.from_external_id,m.from_case_sensitive,m.from_default_value,
      m.to_max_length,m.to_precision,m.to_scale,m.to_required,m.to_unique,m.to_external_id,
      m.to_case_sensitive,m.to_default_value,f.data_type AS current_data_type,
      f.max_length AS current_max_length,f.precision AS current_precision,f.scale AS current_scale,
      f.required AS current_required,f.is_unique AS current_unique,f.external_id AS current_external_id,
      f.case_sensitive AS current_case_sensitive,f.default_value AS current_default_value
    FROM md_field_type_migrations m JOIN md_field_definitions f
      ON f.tenant_id=m.tenant_id AND f.object_api=m.object_api AND f.api_name=m.field_api
    WHERE m.tenant_id=$1 AND m.object_api=$2 AND m.field_api=$3 AND m.id=$4
    FOR UPDATE OF m,f`,[tenantId,objectApi,fieldApi,migrationId]);
  const migration=result.rows[0];
  if(!migration)throw new Error('Field type migration not found');
  if(migration.status!=='applied')throw new Error('Field type migration is not active');
  const configs=await client.query<{
    side:'from'|'to';related_object:string|null;global_value_set_api:string|null;
    controller_field_api:string|null;relationship_type:string|null;relationship_name:string|null;
    child_relationship_name:string|null;delete_behavior:string|null;allow_reparenting:boolean;
    picklist_restricted:boolean;auto_number_format:string|null;formula_expression:string|null;
    formula_return_type:string|null;rollup_child_object:string|null;rollup_relationship_field:string|null;
    rollup_operation:string|null;rollup_source_field:string|null;rollup_filter_logic:string|null;
    auto_number_counter_exists:boolean;auto_number_next_value:string|null;
  }>(`SELECT * FROM md_field_type_migration_config
    WHERE tenant_id=$1 AND migration_id=$2 ORDER BY side`,[tenantId,migrationId]);
  const fromConfig=configs.rows.find(config=>config.side==='from');
  const toConfig=configs.rows.find(config=>config.side==='to');
  if(!fromConfig||!toConfig)
    throw new Error('Field migration metadata snapshots are missing; rollback is unavailable');
  const counter=await client.query<{next_value:string}>(`SELECT next_value::text AS next_value
    FROM md_auto_number_counters WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
  [tenantId,objectApi,fieldApi]);
  if(Boolean(counter.rowCount)!==toConfig.auto_number_counter_exists
    ||(counter.rowCount&&Number(counter.rows[0].next_value)!==Number(toConfig.auto_number_next_value)))
    throw new Error('Auto Number sequence changed after migration; rollback requires a new migration');
  const currentConfig=await client.query<{
    related_object:string|null;relationship_type:string|null;relationship_name:string|null;
    child_relationship_name:string|null;delete_behavior:string|null;allow_reparenting:boolean;
    controller_field_api:string|null;global_value_set_api:string|null;picklist_restricted:boolean;
    auto_number_format:string|null;formula_expression:string|null;formula_return_type:string|null;
    rollup_child_object:string|null;rollup_relationship_field:string|null;rollup_operation:string|null;
    rollup_source_field:string|null;rollup_filter_logic:string|null;
  }>(`SELECT f.related_object,f.relationship_type,f.relationship_name,f.child_relationship_name,
      f.delete_behavior,f.allow_reparenting,f.controller_field_api,
      (SELECT g.value_set_api FROM md_field_global_value_sets g
        WHERE g.tenant_id=f.tenant_id AND g.object_api=f.object_api AND g.field_api=f.api_name)
        AS global_value_set_api,
      f.picklist_restricted,f.auto_number_format,f.formula_expression,f.formula_return_type,
      f.rollup_child_object,f.rollup_relationship_field,f.rollup_operation,f.rollup_source_field,
      f.rollup_filter_logic
    FROM md_field_definitions f
    WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.api_name=$3
    FOR UPDATE`,[tenantId,objectApi,fieldApi]);
  const current=currentConfig.rows[0];
  if(!current||current.related_object!==(toConfig.related_object??null)
    ||current.relationship_type!==(toConfig.relationship_type??null)
    ||current.relationship_name!==(toConfig.relationship_name??null)
    ||current.child_relationship_name!==(toConfig.child_relationship_name??null)
    ||current.delete_behavior!==(toConfig.delete_behavior??null)
    ||current.allow_reparenting!==toConfig.allow_reparenting
    ||current.controller_field_api!==(toConfig.controller_field_api??null)
    ||current.global_value_set_api!==(toConfig.global_value_set_api??null)
    ||current.picklist_restricted!==toConfig.picklist_restricted
    ||current.auto_number_format!==(toConfig.auto_number_format??null)
    ||current.formula_expression!==(toConfig.formula_expression??null)
    ||current.formula_return_type!==(toConfig.formula_return_type??null)
    ||current.rollup_child_object!==(toConfig.rollup_child_object??null)
    ||current.rollup_relationship_field!==(toConfig.rollup_relationship_field??null)
    ||current.rollup_operation!==(toConfig.rollup_operation??null)
    ||current.rollup_source_field!==(toConfig.rollup_source_field??null)
    ||current.rollup_filter_logic!==(toConfig.rollup_filter_logic??null))
    throw new Error('Field metadata changed after migration; rollback requires a new migration');
  const picklists=await client.query<{value:string;side?:string}>(`SELECT value FROM md_field_picklist_values
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 ORDER BY sort_order`,
  [tenantId,objectApi,fieldApi]);
  if(!current.global_value_set_api){
    const snapshotValues=await client.query<{value:string}>(`SELECT value
      FROM md_field_type_migration_picklist_values
      WHERE tenant_id=$1 AND migration_id=$2 AND side='to' ORDER BY sort_order`,
    [tenantId,migrationId]);
    if(JSON.stringify(picklists.rows.map(row=>row.value))!==
      JSON.stringify(snapshotValues.rows.map(row=>row.value)))
      throw new Error('Picklist values changed after migration; rollback requires a new migration');
  }
  const currentRollupFilters=await client.query<{
    filter_field_api:string;operator:string;value_text:string;sort_order:number
  }>(`SELECT filter_field_api,operator,value_text,sort_order FROM md_field_rollup_filters
    WHERE tenant_id=$1 AND object_api=$2 AND rollup_field_api=$3 ORDER BY sort_order`,
  [tenantId,objectApi,fieldApi]);
  const targetRollupFilters=await client.query<{
    filter_field_api:string;operator:string;value_text:string;sort_order:number
  }>(`SELECT filter_field_api,operator,value_text,sort_order
    FROM md_field_type_migration_rollup_filters
    WHERE tenant_id=$1 AND migration_id=$2 AND side='to' ORDER BY sort_order`,
  [tenantId,migrationId]);
  if(JSON.stringify(currentRollupFilters.rows)!==JSON.stringify(targetRollupFilters.rows))
    throw new Error('Roll-up filters changed after migration; rollback requires a new migration');
  if(migration.current_data_type!==migration.to_data_type
    ||migration.current_max_length!==migration.to_max_length
    ||migration.current_precision!==migration.to_precision
    ||migration.current_scale!==migration.to_scale
    ||migration.current_required!==migration.to_required
    ||migration.current_unique!==migration.to_unique
    ||migration.current_external_id!==migration.to_external_id
    ||migration.current_case_sensitive!==migration.to_case_sensitive
    ||migration.current_default_value!==migration.to_default_value)
    throw new Error('Field definition changed after migration; rollback requires a new migration');
  const latest=await client.query<{id:string}>(`SELECT id FROM md_field_type_migrations
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 AND status='applied'
    ORDER BY created_at DESC,id DESC LIMIT 1`,[tenantId,objectApi,fieldApi]);
  if(latest.rows[0]?.id!==migrationId)throw new Error('Field type migrations must be rolled back in reverse order');
  const newRecords=await client.query(`SELECT 1 FROM md_records r
    WHERE r.tenant_id=$1 AND r.object_api=$2 AND NOT EXISTS(
      SELECT 1 FROM md_field_type_migration_values m
      WHERE m.tenant_id=r.tenant_id AND m.migration_id=$3 AND m.record_id=r.id)
    LIMIT 1`,[tenantId,objectApi,migrationId]);
  if(newRecords.rowCount)throw new Error('Records were added after migration; rollback requires a new migration');
  const newValues=await client.query(`SELECT 1 FROM md_record_values v
    WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.field_api=$3
      AND NOT EXISTS(SELECT 1 FROM md_field_type_migration_values m
        WHERE m.tenant_id=$1 AND m.migration_id=$4 AND m.record_id=v.record_id)
    LIMIT 1`,[tenantId,objectApi,fieldApi,migrationId]);
  if(newValues.rowCount)throw new Error('Field values were added after migration; rollback requires a new migration');
  const changedValues=await client.query(`SELECT 1
    FROM md_field_type_migration_values m
    LEFT JOIN md_record_values v ON v.tenant_id=m.tenant_id AND v.record_id=m.record_id
      AND v.object_api=m.object_api AND v.field_api=$3
    WHERE m.tenant_id=$1 AND m.migration_id=$4 AND (
      m.after_value_exists IS DISTINCT FROM (v.record_id IS NOT NULL)
      OR (v.record_id IS NOT NULL AND (
      v.value_text IS DISTINCT FROM m.after_value_text OR v.value_number::text IS DISTINCT FROM m.after_value_number
      OR v.value_boolean IS DISTINCT FROM m.after_value_boolean OR v.value_date::text IS DISTINCT FROM m.after_value_date
      OR v.value_datetime IS DISTINCT FROM m.after_value_datetime
      OR v.reference_record_id IS DISTINCT FROM m.after_reference_record_id
      OR v.geo_latitude IS DISTINCT FROM m.after_geo_latitude
      OR v.geo_longitude IS DISTINCT FROM m.after_geo_longitude
      OR v.address_street IS DISTINCT FROM m.after_address_street
      OR v.address_city IS DISTINCT FROM m.after_address_city
      OR v.address_state IS DISTINCT FROM m.after_address_state
      OR v.address_postal_code IS DISTINCT FROM m.after_address_postal_code
      OR v.address_country IS DISTINCT FROM m.after_address_country
      OR ($7 AND COALESCE((SELECT array_agg(mv.value ORDER BY mv.sort_order)
        FROM md_record_multi_values mv WHERE mv.tenant_id=v.tenant_id
          AND mv.record_id=v.record_id AND mv.object_api=v.object_api AND mv.field_api=v.field_api),'{}')
        IS DISTINCT FROM COALESCE(string_to_array(v.value_text,';'),'{}'))
      OR v.is_unique IS DISTINCT FROM $5
      OR v.case_sensitive IS DISTINCT FROM $6))
    LIMIT 1`,[tenantId,objectApi,fieldApi,migrationId,migration.to_unique,
      migration.to_case_sensitive,migration.to_data_type==='multipicklist']);
  if(changedValues.rowCount)throw new Error('Field values changed after migration; rollback requires a new migration');
  await client.query(`UPDATE md_field_definitions SET data_type=$4,max_length=$5,precision=$6,scale=$7,
      required=$8,is_unique=$9,external_id=$10,case_sensitive=$11,default_value=$12,
      related_object=$13,relationship_type=$14,relationship_name=$15,child_relationship_name=$16,
      delete_behavior=$17,allow_reparenting=$18,controller_field_api=$19,
      picklist_restricted=$20,auto_number_format=$21,formula_expression=$22,formula_return_type=$23,
      rollup_child_object=$24,rollup_relationship_field=$25,rollup_operation=$26,
      rollup_source_field=$27,rollup_filter_logic=$28
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3`,
  [tenantId,objectApi,fieldApi,migration.from_data_type,migration.from_max_length,
    migration.from_precision,migration.from_scale,migration.from_required,migration.from_unique,
    migration.from_external_id,migration.from_case_sensitive,migration.from_default_value,
    fromConfig.related_object,fromConfig.relationship_type,fromConfig.relationship_name,
    fromConfig.child_relationship_name,fromConfig.delete_behavior,fromConfig.allow_reparenting,
    fromConfig.controller_field_api,fromConfig.picklist_restricted,fromConfig.auto_number_format,
    fromConfig.formula_expression,fromConfig.formula_return_type,fromConfig.rollup_child_object,
    fromConfig.rollup_relationship_field,fromConfig.rollup_operation,fromConfig.rollup_source_field,
    fromConfig.rollup_filter_logic]);
  await client.query(`DELETE FROM md_field_global_value_sets
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
  if(fromConfig.global_value_set_api)await client.query(`INSERT INTO md_field_global_value_sets
    (tenant_id,object_api,field_api,value_set_api) VALUES($1,$2,$3,$4)`,
  [tenantId,objectApi,fieldApi,fromConfig.global_value_set_api]);
  await client.query(`DELETE FROM md_field_picklist_values
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
  if(!fromConfig.global_value_set_api)await client.query(`INSERT INTO md_field_picklist_values
    (tenant_id,object_api,field_api,value,sort_order)
    SELECT $1,$2,$3,value,sort_order FROM md_field_type_migration_picklist_values
    WHERE tenant_id=$1 AND migration_id=$4 AND side='from' ORDER BY sort_order`,
  [tenantId,objectApi,fieldApi,migrationId]);
  await client.query(`DELETE FROM md_field_rollup_filters
    WHERE tenant_id=$1 AND object_api=$2 AND rollup_field_api=$3`,[tenantId,objectApi,fieldApi]);
  if(fromConfig.rollup_child_object)await client.query(`INSERT INTO md_field_rollup_filters
    (tenant_id,object_api,rollup_field_api,child_object,filter_field_api,operator,value_text,sort_order)
    SELECT $1,$2,$3,$4,filter_field_api,operator,value_text,sort_order
    FROM md_field_type_migration_rollup_filters
    WHERE tenant_id=$1 AND migration_id=$5 AND side='from' ORDER BY sort_order`,
  [tenantId,objectApi,fieldApi,fromConfig.rollup_child_object,migrationId]);
  const snapshots=await client.query<{
    record_id:string;before_value_exists:boolean;before_snapshot_encrypted:boolean;
    before_value_text:string|null;before_value_number:string|null;before_value_boolean:boolean|null;
    before_value_date:string|null;before_value_datetime:Date|string|null;
    before_reference_record_id:string|null;before_geo_latitude:number|null;before_geo_longitude:number|null;
    before_address_street:string|null;before_address_city:string|null;before_address_state:string|null;
    before_address_postal_code:string|null;before_address_country:string|null;
    before_is_unique:boolean;before_case_sensitive:boolean;
  }>(`SELECT record_id,before_value_exists,before_snapshot_encrypted,before_value_text,
      before_value_number::text AS before_value_number,before_value_boolean,
      before_value_date::text AS before_value_date,before_value_datetime,before_reference_record_id,
      before_geo_latitude,before_geo_longitude,before_address_street,before_address_city,
      before_address_state,before_address_postal_code,before_address_country,
      before_is_unique,before_case_sensitive FROM md_field_type_migration_values
    WHERE tenant_id=$1 AND migration_id=$2 ORDER BY record_id`,[tenantId,migrationId]);
  for(const snapshot of snapshots.rows){
    if(!snapshot.before_value_exists){
      await client.query(`DELETE FROM md_record_values
        WHERE tenant_id=$1 AND record_id=$2 AND object_api=$3 AND field_api=$4`,
      [tenantId,snapshot.record_id,objectApi,fieldApi]);
      continue;
    }
    let valueText=snapshot.before_value_text;
    if(snapshot.before_snapshot_encrypted){
      if(!runtime.encryptedValueVault)throw new Error('Encrypted field vault is unavailable for rollback');
      if(valueText===null)throw new Error('Encrypted migration snapshot is missing its value');
      valueText=decryptFieldValue(runtime.encryptedValueVault,tenantId,objectApi,fieldApi,valueText);
    }
    await client.query(`INSERT INTO md_record_values
      (tenant_id,record_id,object_api,field_api,value_text,value_number,value_boolean,value_date,
       value_datetime,reference_record_id,geo_latitude,geo_longitude,address_street,address_city,
       address_state,address_postal_code,address_country,is_unique,case_sensitive)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT(tenant_id,record_id,field_api) DO UPDATE SET
        value_text=EXCLUDED.value_text,value_number=EXCLUDED.value_number,
        value_boolean=EXCLUDED.value_boolean,value_date=EXCLUDED.value_date,
        value_datetime=EXCLUDED.value_datetime,reference_record_id=EXCLUDED.reference_record_id,
        geo_latitude=EXCLUDED.geo_latitude,geo_longitude=EXCLUDED.geo_longitude,
        address_street=EXCLUDED.address_street,address_city=EXCLUDED.address_city,
        address_state=EXCLUDED.address_state,address_postal_code=EXCLUDED.address_postal_code,
        address_country=EXCLUDED.address_country,is_unique=EXCLUDED.is_unique,
        case_sensitive=EXCLUDED.case_sensitive`,
    [tenantId,snapshot.record_id,objectApi,fieldApi,valueText,snapshot.before_value_number,
      snapshot.before_value_boolean,snapshot.before_value_date,snapshot.before_value_datetime,
      snapshot.before_reference_record_id,snapshot.before_geo_latitude,snapshot.before_geo_longitude,
      snapshot.before_address_street,snapshot.before_address_city,snapshot.before_address_state,
      snapshot.before_address_postal_code,snapshot.before_address_country,snapshot.before_is_unique,
      snapshot.before_case_sensitive]);
  }
  await client.query(`DELETE FROM md_record_multi_values
    WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
  if(migration.from_data_type==='multipicklist')await client.query(`INSERT INTO md_record_multi_values
    (tenant_id,record_id,object_api,field_api,value,sort_order)
    SELECT v.tenant_id,v.record_id,v.object_api,v.field_api,choice.value,(choice.ordinality-1)::integer
    FROM md_record_values v
    CROSS JOIN LATERAL unnest(string_to_array(v.value_text,';')) WITH ORDINALITY choice(value,ordinality)
    WHERE v.tenant_id=$1 AND v.object_api=$2 AND v.field_api=$3 AND v.value_text IS NOT NULL`,
  [tenantId,objectApi,fieldApi]);
  if(fromConfig.auto_number_counter_exists){
    if(fromConfig.auto_number_next_value===null)
      throw new Error('Auto Number counter snapshot is incomplete; rollback is unavailable');
    await client.query(`INSERT INTO md_auto_number_counters
      (tenant_id,object_api,field_api,next_value) VALUES($1,$2,$3,$4)
      ON CONFLICT(tenant_id,object_api,field_api) DO UPDATE SET next_value=EXCLUDED.next_value`,
    [tenantId,objectApi,fieldApi,fromConfig.auto_number_next_value]);
  }else{
    await client.query(`DELETE FROM md_auto_number_counters
      WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
  }
  await client.query(`UPDATE md_field_type_migrations SET status='rolled_back',rolled_back_at=now()
    WHERE tenant_id=$1 AND id=$2`,[tenantId,migrationId]);
}
