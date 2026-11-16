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

// TODO(native): field type changes are switched off until native-value migration is supported.
export async function applyFieldTypeMigration(
 _client:PoolClient,_tenantId:string,_objectApi:string,_fieldApi:string,
 _actorUserId:string|null,_expected:FieldTypeSnapshot,_target:FieldTypeTarget,
 _runtime:FieldTypeMigrationRuntime={}
):Promise<string>{
 throw new Error('Changing a field type is switched off for now');
}

// TODO(native): rollback is unavailable while field type changes are switched off.
export async function rollbackFieldTypeMigration(
 _client:PoolClient,_tenantId:string,_objectApi:string,_fieldApi:string,
 _migrationId:string,_runtime:FieldTypeMigrationRuntime={}
):Promise<void>{
 throw new Error('Changing a field type is switched off for now');
}
