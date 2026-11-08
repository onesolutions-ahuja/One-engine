import {requireAvailableMetadataName} from '../system-support/metadata-name-guard.js';
import {validateFieldDefinitionAttributes} from './field-definition-attributes.js';
import type {PoolClient} from 'pg';
import type {SqlPersistence} from './sql-persistence.js';
import {
  flowFormulaReferences,inferFlowFormulaType,validateFlowFormula,
  type FormulaValueType
} from './flow-formula-runtime.js';
import {ObjectMetadataHistory} from './object-metadata-history.js';
import {
  applyFieldTypeMigration,fieldTypeSignature,rollbackFieldTypeMigration,
  type FieldTypeMigrationRuntime,type FieldTypeTarget
} from './field-type-migration.js';
type SqlObject={id:string;api_name:string;label:string;is_system:boolean};
type SqlField={id:string;label:string|null;object_api:string;api_name:string;data_type:string;related_object:string|null;relationship_type:string|null;required:boolean;max_length:number|null;precision:number|null;scale:number|null;is_unique:boolean;external_id:boolean;case_sensitive:boolean;default_value:string|null;help_text:string|null;description:string|null;formula_expression:string|null;formula_return_type:string|null;auto_number_format:string|null;rollup_child_object?:string|null;rollup_relationship_field?:string|null;rollup_operation?:string|null;rollup_source_field?:string|null;rollup_filter_logic?:string;picklist_restricted?:boolean;controller_field_api_name?:string|null;global_value_set_api?:string|null;relationship_name?:string|null;child_relationship_name?:string|null;delete_behavior?:string|null;allow_reparenting?:boolean;track_history?:boolean;deleted_at?:Date|null};
const sqlFieldTypes:Record<string,string>={
  text:'text',number:'number',checkbox:'boolean',boolean:'boolean',date:'date',
  datetime:'datetime','date/time':'datetime',lookup:'reference',reference:'reference',
  email:'email',phone:'phone',url:'url',image:'image',file:'file',picklist:'picklist',
  textarea:'textarea','textarea(long)':'longtext',longtextarea:'longtext',
  currency:'currency',percent:'percent',  'multi-selectpicklist':'multipicklist','roll-upsummary':'rollup',
  geolocation:'geolocation',address:'address','richtextarea':'richtext',time:'time',
  'auto number':'autonumber',autonumber:'autonumber','text(encrypted)':'encryptedtext',
  encryptedtext:'encryptedtext'
};
type ParsedField={
  apiName:string;label:string;dataType:string;relatedObject:string|null;relationshipType:string|null;
  relationshipName:string|null;childRelationshipName:string|null;deleteBehavior:string|null;allowReparenting:boolean;
  required:boolean;maxLength:number|null;precision:number|null;scale:number|null;
  unique:boolean;externalId:boolean;caseSensitive:boolean;trackHistory:boolean;defaultValue:string|null;
  helpText:string|null;description:string|null;formulaExpression:string|null;
  formulaReturnType:string|null;autoNumberFormat:string|null;
  rollup:{childObject:string;relationshipField:string;operation:'COUNT'|'SUM'|'MIN'|'MAX';
    sourceField:string|null;filterLogic:'All'|'Any';filters:Array<{fieldApiName:string;operator:string;value:string}>}|null;
  picklistValues:string[];restricted:boolean;controllerFieldApiName:string|null;
  globalValueSetApiName:string|null;
  valueSettings:Record<string,string[]>;
};
const parseFieldDefinition=(field:Record<string,unknown>,objectApi?:string):ParsedField=>{
  const name=field.apiName;
  const dataType=typeof field.dataType==='string'?field.dataType:'';
  const compact=dataType.toLowerCase().replace(/\s+/g,'');
  const compactPreservingCase=dataType.replace(/\s+/g,'');
  const numeric=/^(number|currency|percent)\(([0-9]+),([0-9]+)\)$/.exec(compact);
  const text=/^text\(([0-9]+)\)$/.exec(compact);
  const relationship=/^(lookup|master-detail)\(([A-Za-z][A-Za-z0-9_]*)\)$/i.exec(compactPreservingCase);
  const formula=/^formula\((text|number|currency|percent|date|datetime|time|checkbox)\)$/.exec(compact);
  const type=numeric?numeric[1]:text?'text':relationship?'reference':formula?'formula':sqlFieldTypes[compact];
  const maxLength=text?Number(text[1]):type==='textarea'?255:
    ['longtext','richtext'].includes(type)?131072:type==='encryptedtext'?175:type==='phone'?40:null;
  const precision=numeric?Number(numeric[2]):null;
  const scale=numeric?Number(numeric[3]):null;
  if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)||!type)
    throw new Error('Invalid field definition');
  if(maxLength!==null&&(!Number.isSafeInteger(maxLength)||maxLength<1||maxLength>1000000))
    throw new Error('Invalid text field length');
  if(precision!==null&&(!Number.isSafeInteger(precision)||precision<1||precision>18
    ||scale===null||!Number.isSafeInteger(scale)||scale<0||scale>precision))
    throw new Error('Invalid numeric precision or scale');
  if(type==='textarea'&&(field.unique===true||field.externalId===true))
    throw new Error('Text Area fields cannot be unique or external IDs');
  if(type==='richtext'&&(field.unique===true||field.externalId===true))
    throw new Error('Rich Text Area fields cannot be unique or external IDs');
  if(type==='formula'&&(field.unique===true||field.externalId===true||field.required===true
  ||(field.defaultValue!==undefined&&field.defaultValue!==null)))
  throw new Error('Formula fields cannot be required, unique, external IDs or have defaults');
  if(['image','file'].includes(type)&&(field.unique===true||field.externalId===true
    ||(field.defaultValue!==undefined&&field.defaultValue!==null)))
    throw new Error('Image and File fields cannot be unique, external IDs or have defaults');
  if(type==='encryptedtext'&&(field.unique===true||field.externalId===true
    ||(field.defaultValue!==undefined&&field.defaultValue!==null)))
    throw new Error('Encrypted Text fields cannot be unique, external IDs or have defaults');
  if(type==='rollup'&&(field.unique===true||field.externalId===true||field.required===true
    ||(field.defaultValue!==undefined&&field.defaultValue!==null)))
    throw new Error('Roll-Up Summary fields cannot be required, unique, external IDs or have defaults');
  const relation=field.relationship&&typeof field.relationship==='object'&&!Array.isArray(field.relationship)
    ?field.relationship as Record<string,unknown>:undefined;
  const rawRelatedObject=relationship?.[2]??relation?.targetObject??field.relatedObject;
  if(type==='reference'&&(typeof rawRelatedObject!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(rawRelatedObject)))
    throw new Error('Invalid relationship target');
  const relatedObject=typeof rawRelatedObject==='string'?rawRelatedObject:null;
  const relationshipType=relationship?.[1].toLowerCase()==='master-detail'?'Master-Detail'
    :type==='reference'&&typeof relation?.type==='string'?relation.type
      :type==='reference'?'Lookup':null;
  if(relationshipType!==null&&!['Lookup','Master-Detail','Hierarchical'].includes(relationshipType))
    throw new Error('Invalid relationship type');
  if((relationshipType!==null||['address','geolocation','multipicklist'].includes(type))
    &&(field.unique===true||field.externalId===true))
    throw new Error('Relationship, compound and multi-select fields cannot be unique or external IDs');
  const relationshipName: string|null=relationshipType===null?null:
    typeof relation?.relationshipName==='string'?relation.relationshipName:
      relation?.relationshipName===undefined?name.replace(/Id$/,''):null;
  const childRelationshipName: string|null=relationshipType===null?null:
    typeof relation?.childRelationshipName==='string'?relation.childRelationshipName:
      relation?.childRelationshipName===undefined?`${(objectApi??'Record').replace(/__c$/,'')}${name.replace(/Id$/,'')}Records`.slice(0,80):null;
  const deleteBehavior: string|null=relationshipType==='Lookup'
    ?relation?.deleteBehavior===undefined?'Clear':
      typeof relation.deleteBehavior==='string'?relation.deleteBehavior:null
    :relationshipType==='Master-Detail'?'Cascade':null;
  const allowReparenting=relationshipType==='Master-Detail'?relation?.allowReparenting===true:false;
  const relationshipNamePattern=/^[A-Za-z][A-Za-z0-9_]*$/;
  if(relationshipType!==null&&
    (typeof relationshipName!=='string'||relationshipName.length>80||!relationshipNamePattern.test(relationshipName)
      ||typeof childRelationshipName!=='string'||childRelationshipName.length>80||!relationshipNamePattern.test(childRelationshipName)))
    throw new Error('Invalid relationship name');
  if(relationshipType==='Lookup'&&!['Clear','Restrict','Cascade'].includes(String(deleteBehavior)))
    throw new Error('Invalid relationship delete behavior');
  if(relationshipType==='Master-Detail'&&relation?.allowReparenting!==undefined
    &&typeof relation.allowReparenting!=='boolean')
    throw new Error('Invalid relationship reparenting setting');
  const formulaMetadata=field.formula&&typeof field.formula==='object'&&!Array.isArray(field.formula)
    ?field.formula as Record<string,unknown>:undefined;
  const formulaExpression=formulaMetadata?.expression;
  if(type==='formula'&&(typeof formulaExpression!=='string'||!formulaExpression.trim()||formulaExpression.length>4000))
    throw new Error('Formula expression is required');
  if(type==='formula')validateFlowFormula(String(formulaExpression),'formula_field');
  let rollup:ParsedField['rollup']=null;
  if(type==='rollup'){
    const config=field.rollup&&typeof field.rollup==='object'&&!Array.isArray(field.rollup)
      ?field.rollup as Record<string,unknown>:null;
    if(!config||typeof config.childObject!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(config.childObject)
      ||typeof config.relationshipField!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(config.relationshipField)
      ||!['COUNT','SUM','MIN','MAX'].includes(String(config.operation))
      ||(config.operation==='COUNT'?config.sourceField!==undefined&&config.sourceField!==null
        :typeof config.sourceField!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(config.sourceField)))
      throw new Error('Invalid roll-up summary definition');
    const filterLogic=config.filterLogic??'All';
    const rawFilters=config.filters===undefined?[]:config.filters;
    if(!['All','Any'].includes(String(filterLogic))
      ||!Array.isArray(rawFilters)||rawFilters.length>20)
      throw new Error('Invalid roll-up filter criteria');
    const filters=rawFilters.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid roll-up filter');
      const filter=item as Record<string,unknown>;
      if(typeof filter.fieldApiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(filter.fieldApiName)
        ||!['Equals','Not Equal To','Greater Than','Less Than','Contains','Is Null','Is Not Null'].includes(String(filter.operator))
        ||(filter.operator==='Is Null'||filter.operator==='Is Not Null'
          ?filter.value!==undefined&&filter.value!==null&&filter.value!==''
          :typeof filter.value!=='string'&&typeof filter.value!=='number'&&typeof filter.value!=='boolean'))
        throw new Error('Invalid roll-up filter');
      return {fieldApiName:filter.fieldApiName,operator:String(filter.operator),
        value:filter.value===undefined||filter.value===null?'':String(filter.value)};
    });
    rollup={childObject:config.childObject,relationshipField:config.relationshipField,
      operation:config.operation as 'COUNT'|'SUM'|'MIN'|'MAX',
      sourceField:typeof config.sourceField==='string'?config.sourceField:null,
      filterLogic:filterLogic as 'All'|'Any',filters};
  }
  const formulaReturnType=formula?.[1]
    ?formula[1]==='datetime'?'DateTime':formula[1][0].toUpperCase()+formula[1].slice(1)
    :type==='formula'&&typeof formulaMetadata?.returnType==='string'?formulaMetadata.returnType:null;
  const rawGlobalValueSet=field.globalValueSetApiName;
  if(rawGlobalValueSet!==undefined&&rawGlobalValueSet!==null
    &&(typeof rawGlobalValueSet!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(rawGlobalValueSet)
      ||!['picklist','multipicklist'].includes(type)))
    throw new Error('Invalid global value set reference');
  const globalValueSetApiName=typeof rawGlobalValueSet==='string'?rawGlobalValueSet:null;
  const picklistValues=['picklist','multipicklist'].includes(type)
    ?globalValueSetApiName?[]:parsePicklistValues(field.picklistValues):[];
  const controllerFieldApiName=field.controllerFieldApiName;
  const valueSettings=field.valueSettings;
  if(controllerFieldApiName!==undefined&&controllerFieldApiName!==null&&
    (typeof controllerFieldApiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(controllerFieldApiName)))
    throw new Error('Invalid dependent picklist controller');
  const parsedValueSettings=parsePicklistValueSettings(valueSettings);
  if((controllerFieldApiName===undefined||controllerFieldApiName===null)!==
    (valueSettings===undefined||valueSettings===null))
    throw new Error('Dependent picklist controller and value settings are required together');
  if(controllerFieldApiName&&(type!=='picklist'||parsedValueSettings===null))
    throw new Error('Dependent picklists require a single-select picklist field');
  const normalizedDefault=validateFieldDefinitionAttributes({
    dataType:type,unique:type==='autonumber'||field.unique===true,
    externalId:field.externalId===true,caseSensitive:field.caseSensitive===true,
    maxLength,precision,scale,defaultValue:field.defaultValue,
    picklistValues,globalValueSetApiName
  });
  const autoNumberFormat=field.autoNumberFormat;
  if(type==='autonumber'&&autoNumberFormat!==undefined&&
    (typeof autoNumberFormat!=='string'||autoNumberFormat.length>80
      ||(!/\{0+\}/.test(autoNumberFormat)&&!/\{YYYY\}/.test(autoNumberFormat))))
    throw new Error('Invalid auto-number format');
  if(typeof field.helpText==='string'&&field.helpText.length>255)
    throw new Error('Invalid field help text');
  if(typeof field.description==='string'&&field.description.length>1000)
    throw new Error('Invalid field description');
  if(field.trackHistory!==undefined&&typeof field.trackHistory!=='boolean')
    throw new Error('Invalid field history setting');
  if(field.trackHistory===true&&type==='encryptedtext')
    throw new Error('Encrypted fields cannot be tracked in plaintext history');
  return {
    apiName:name,label:typeof field.label==='string'&&field.label.trim()?field.label.trim():name,
    dataType:type,relatedObject:type==='reference'?relatedObject:null,relationshipType,
    relationshipName,childRelationshipName,deleteBehavior,allowReparenting,
    required:relationshipType==='Master-Detail'||type==='autonumber'||field.required===true,maxLength,precision,scale,
    unique:type==='autonumber'||field.unique===true,externalId:field.externalId===true,
    caseSensitive:field.caseSensitive===true,trackHistory:field.trackHistory===true,
    defaultValue:normalizedDefault,
    helpText:typeof field.helpText==='string'&&field.helpText.trim()?field.helpText.trim():null,
    description:typeof field.description==='string'&&field.description.trim()?field.description.trim():null,
    formulaExpression:type==='formula'?(formulaExpression as string).trim():null,
    formulaReturnType,autoNumberFormat:typeof autoNumberFormat==='string'?autoNumberFormat:null,rollup,
    picklistValues,restricted:field.picklistRestricted!==false,
    controllerFieldApiName:typeof controllerFieldApiName==='string'?controllerFieldApiName:null,
    globalValueSetApiName,
    valueSettings:parsedValueSettings??{}
  };
};
const parsePicklistValues=(input:unknown):string[]=>{
  if(!Array.isArray(input)||input.length===0||input.length>200
    ||input.some(item=>typeof item!=='string'||!item.trim()||item.length>512)
    ||new Set(input).size!==input.length)throw new Error('Invalid picklist values');
  return input as string[];
};
async function validateRollupWithin(client:Pick<PoolClient,'query'>,tenantId:string,objectApi:string,
  rollup:NonNullable<ParsedField['rollup']>) {
  const relationship=await client.query<{data_type:string;related_object:string;relationship_type:string}>(
    `SELECT data_type,related_object,relationship_type FROM md_field_definitions
     WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
    [tenantId,rollup.childObject,rollup.relationshipField]);
  const relation=relationship.rows[0];
  if(!relation||relation.data_type!=='reference'||relation.relationship_type!=='Master-Detail'
    ||relation.related_object!==objectApi)
    throw new Error('Roll-Up Summary requires an active Master-Detail field to this object');
  if(rollup.operation==='SUM'){
    const source=await client.query<{data_type:string}>(`SELECT data_type FROM md_field_definitions
      WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
    [tenantId,rollup.childObject,rollup.sourceField]);
    if(!source.rows[0]||!['number','currency','percent'].includes(source.rows[0].data_type))
      throw new Error('SUM roll-ups require a numeric source field');
  }else if(rollup.operation==='MIN'||rollup.operation==='MAX'){
    const source=await client.query<{data_type:string}>(`SELECT data_type FROM md_field_definitions
      WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
    [tenantId,rollup.childObject,rollup.sourceField]);
    if(!source.rows[0]||!['number','currency','percent','date','datetime'].includes(source.rows[0].data_type))
      throw new Error('MIN/MAX roll-ups require a numeric, Date or Date/Time source field');
  }
  if(!rollup.filters.length)return;
  const filterFields=await client.query<{api_name:string;data_type:string}>(`
    SELECT api_name,data_type FROM md_field_definitions
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=ANY($3::text[]) AND deleted_at IS NULL`,
  [tenantId,rollup.childObject,rollup.filters.map(filter=>filter.fieldApiName)]);
  const byApi=new Map(filterFields.rows.map(item=>[item.api_name,item.data_type]));
  for(const filter of rollup.filters){
    const dataType=byApi.get(filter.fieldApiName);
    if(!dataType||['formula','rollup','geolocation','address','encryptedtext'].includes(dataType))
      throw new Error('Roll-Up filter field is invalid');
    const numericTypes=['number','currency','percent'];
    const dateTypes=['date','datetime','time'];
    const textTypes=['text','email','phone','url','textarea','longtext','richtext','picklist'];
    if(filter.operator==='Contains'&&!textTypes.includes(dataType))
      throw new Error('Contains requires a text roll-up filter field');
    if(['Greater Than','Less Than'].includes(filter.operator)
      &&!numericTypes.includes(dataType)&&!dateTypes.includes(dataType))
      throw new Error('Comparison operator is invalid for roll-up filter field');
    if(filter.operator==='Is Null'||filter.operator==='Is Not Null')continue;
    if(numericTypes.includes(dataType)&&! /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(filter.value))
      throw new Error('Invalid numeric roll-up filter value');
    if(dataType==='boolean'&&!['true','false'].includes(filter.value))
      throw new Error('Invalid checkbox roll-up filter value');
    if(dataType==='reference'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filter.value))
      throw new Error('Invalid relationship roll-up filter value');
    if(dataType==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(filter.value)
      ||Number.isNaN(Date.parse(filter.value+'T00:00:00Z'))))
      throw new Error('Invalid date roll-up filter value');
    if(dataType==='datetime'&&Number.isNaN(Date.parse(filter.value)))
      throw new Error('Invalid date/time roll-up filter value');
    if(dataType==='time'&&!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(filter.value))
      throw new Error('Invalid time roll-up filter value');
  }
}
async function loadPicklistValues(client:Pick<PoolClient,'query'>,tenantId:string,objectApi:string,fieldApi:string) {
  const {rows}=await client.query<{value:string}>(`
    SELECT value FROM md_field_picklist_values p
    WHERE p.tenant_id=$1 AND p.object_api=$2 AND p.field_api=$3
      AND NOT EXISTS(SELECT 1 FROM md_field_global_value_sets g
        WHERE g.tenant_id=p.tenant_id AND g.object_api=p.object_api AND g.field_api=p.field_api)
    UNION
    SELECT v.value FROM md_field_global_value_sets g
    JOIN md_global_value_set_values v ON v.tenant_id=g.tenant_id
      AND v.value_set_id=(SELECT s.id FROM md_global_value_sets s
        WHERE s.tenant_id=g.tenant_id AND s.api_name=g.value_set_api)
    WHERE g.tenant_id=$1 AND g.object_api=$2 AND g.field_api=$3 AND v.active
    ORDER BY value`,[tenantId,objectApi,fieldApi]);
  return rows.map(row=>row.value);
}
const parsePicklistValueSettings=(input:unknown):Record<string,string[]>|null=>{
  if(input===undefined||input===null)return null;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)
    throw new Error('Invalid dependent picklist values');
  const entries=Object.entries(input);
  if(entries.length===0||entries.length>200)throw new Error('Invalid dependent picklist values');
  const result:Record<string,string[]>={};
  for(const [controllerValue,values] of entries){
    if(!controllerValue||controllerValue.length>512||!Array.isArray(values)||values.length>200||
      values.some(value=>typeof value!=='string'||!value.trim()||value.length>512)||
      new Set(values).size!==values.length)
      throw new Error('Invalid dependent picklist values');
    result[controllerValue]=values as string[];
  }
  return result;
};
const normalizeValueSettings=(input:unknown)=>{
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  return Object.entries(input).sort(([left],[right])=>left.localeCompare(right))
    .map(([key,values])=>[key,Array.isArray(values)?[...values].sort():values]);
};
const decodeFieldDefault=(type:string,value:string):string|number|boolean=>{
  if(['number','currency','percent'].includes(type))return Number(value);
  if(type==='boolean')return value==='true';
  return value;
};
const formulaTypeForField=(dataType:string,returnType:string|null,rollupSourceType:string|null=null):FormulaValueType|null=>{
  if(dataType==='formula'){
    const normalized=returnType?.toLowerCase();
    if(['number','currency','percent'].includes(normalized??''))return 'Number';
    if(normalized==='text')return 'Text';
    if(normalized==='checkbox')return 'Checkbox';
    if(normalized==='date')return 'Date';
    if(normalized==='datetime')return 'DateTime';
    if(normalized==='time')return 'Time';
    return null;
  }
  if(dataType==='rollup')return formulaTypeForField(rollupSourceType??'number',null);
  if(['number','currency','percent'].includes(dataType))return 'Number';
  if(dataType==='boolean')return 'Checkbox';
  if(dataType==='date')return 'Date';
  if(dataType==='datetime')return 'DateTime';
  if(dataType==='time')return 'Time';
  if(dataType==='geolocation')return 'Geolocation';
  if(dataType==='picklist')return 'Picklist';
  if(dataType==='multipicklist')return 'MultiPicklist';
  if(['text','email','phone','url','textarea','longtext','richtext','autonumber','reference','address'].includes(dataType))
    return 'Text';
  return null;
};
type RelatedListSettings={
  columns?:string[];sortField?:string;sortDirection?:'asc'|'desc';
  filterField?:string;filterValue?:string;filterOperator?:'Equals'|'Includes'|'Excludes';
  pageSize?:10|25|50;showNewAction?:boolean;showRowActions?:boolean
};
const relatedFieldPattern=/^[A-Za-z][A-Za-z0-9_]*$/;
export function validateRelatedListSettings(names:string[],input:unknown):Record<string,RelatedListSettings>{
  if(input===undefined)return {};
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid related list settings');
  const values=input as Record<string,unknown>;
  if(Object.keys(values).length>names.length)throw new Error('Unknown related list configuration');
  const result:Record<string,RelatedListSettings>={};
  for(const [name,raw] of Object.entries(values)){
    if(!names.includes(name)||!raw||typeof raw!=='object'||Array.isArray(raw))
      throw new Error('Unknown related list configuration');
    const v=raw as Record<string,unknown>;
    const allowed=['columns','sortField','sortDirection','filterField','filterValue',
      'filterOperator','pageSize','showNewAction','showRowActions'];
    if(Object.keys(v).some(key=>!allowed.includes(key)))throw new Error('Invalid related list property');
    if(v.columns!==undefined&&(!Array.isArray(v.columns)||v.columns.length>12
      ||new Set(v.columns).size!==v.columns.length
      ||v.columns.some(x=>typeof x!=='string'||!relatedFieldPattern.test(x))))
      throw new Error('Invalid related list columns');
    for(const key of ['sortField','filterField']){
      if(v[key]!==undefined&&(typeof v[key]!=='string'||!relatedFieldPattern.test(v[key])))
        throw new Error('Invalid related list field');
    }
    if(v.sortDirection!==undefined&&!['asc','desc'].includes(String(v.sortDirection)))
      throw new Error('Invalid related list sort direction');
    if(v.filterOperator!==undefined&&!['Equals','Includes','Excludes'].includes(String(v.filterOperator)))
      throw new Error('Invalid related list filter operator');
    if(v.filterValue!==undefined&&(typeof v.filterValue!=='string'||v.filterValue.length>256))
      throw new Error('Invalid related list filter value');
    if((v.filterField===undefined)!==(v.filterValue===undefined))
      throw new Error('Related list filter field and value must be set together');
    if(v.pageSize!==undefined&&![10,25,50].includes(Number(v.pageSize)))
      throw new Error('Invalid related list page size');
    if((v.showNewAction!==undefined&&typeof v.showNewAction!=='boolean')
      ||(v.showRowActions!==undefined&&typeof v.showRowActions!=='boolean'))
      throw new Error('Invalid related list action visibility');
    result[name]=v as RelatedListSettings;
  }
  return result;
}

export class ObjectDefinitionService {
  constructor(private readonly db:SqlPersistence,
    private readonly migrationRuntime:FieldTypeMigrationRuntime={}) {}
  async validateFormula(tenantId:string,objectApi:string,expression:string,returnType:string,
    formulaFieldApi?:string) {
    return this.db.transaction(client=>
      this.validateFormulaWithin(client,tenantId,objectApi,expression,returnType,formulaFieldApi));
  }
  private async validateFormulaWithin(client:Pick<PoolClient,'query'>,tenantId:string,objectApi:string,
    expression:string,returnType:string,formulaFieldApi?:string) {
    const normalizedReturnType=returnType.toLowerCase();
    if(!['number','currency','percent','text','date','datetime','time','checkbox'].includes(normalizedReturnType))
      throw new Error('Unsupported formula return type');
    validateFlowFormula(expression,'formula_field');
    const references=flowFormulaReferences(expression);
    const referenceTypes=new Map<string,FormulaValueType>();
    const publicReferences:Array<{objectApi:string;fieldApi:string}>=[];
    for(const reference of references){
      // Keep legacy Object.Field syntax, but resolve relationship field APIs and
      // configured aliases at every hop. Never guess between multiple edges.
      const match=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(reference);
      let targetObject=objectApi;
      let targetField='';
      if(match){
        targetObject=match[1];targetField=match[2];
        if(targetObject!==objectApi){
          const relationship=await client.query(`SELECT 1 FROM md_field_definitions
            WHERE tenant_id=$1 AND object_api=$2 AND related_object=$3 AND data_type='reference'
              AND deleted_at IS NULL`,[tenantId,objectApi,targetObject]);
          if(relationship.rowCount!==1){
            const aliases=await client.query<{related_object:string}>(`
              SELECT related_object FROM md_field_definitions
              WHERE tenant_id=$1 AND object_api=$2 AND data_type='reference'
                AND deleted_at IS NULL AND (api_name=$3 OR relationship_name=$3)`,
            [tenantId,objectApi,targetObject]);
            if(aliases.rows.length!==1)throw new Error(
              'Formula cross-object reference requires a lookup relationship with an unambiguous name');
            targetObject=aliases.rows[0].related_object;
          }
        }
      }else{
        const raw=reference.startsWith('$Record.')?reference.slice(8):reference;
        const parts=raw.split('.');
        if(parts.length<1||parts.length>7||parts.some(part=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(part)))
          throw new Error('Invalid formula relationship field path');
        const steps=parts[0]===objectApi||parts[0]==='Record'?parts.slice(1):parts;
        targetField=steps.pop()??'';
        if(!targetField)throw new Error('Invalid formula relationship field path');
        for(const hop of steps){
          const result=await client.query<{api_name:string;related_object:string;relationship_name:string|null}>(`
            SELECT api_name,related_object,relationship_name
            FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2
              AND data_type='reference' AND deleted_at IS NULL
              AND (api_name=$3 OR relationship_name=$3 OR related_object=$3)`,
            [tenantId,targetObject,hop]);
          const named=result.rows.filter(row=>row.api_name===hop||row.relationship_name===hop);
          const candidates=named.length?named:result.rows;
          if(candidates.length!==1)throw new Error(
            'Formula requires one unambiguous metadata relationship: '+hop);
          targetObject=candidates[0].related_object;
        }
      }
      if(targetObject===objectApi&&targetField===formulaFieldApi)
        throw new Error('Formula fields cannot reference themselves');
      const field=await client.query<{data_type:string;formula_return_type:string|null;rollup_source_type:string|null}>(`
        SELECT f.data_type,f.formula_return_type,
          (SELECT s.data_type FROM md_field_definitions s
           WHERE s.tenant_id=f.tenant_id AND s.object_api=f.rollup_child_object
             AND s.api_name=f.rollup_source_field AND s.deleted_at IS NULL) AS rollup_source_type
        FROM md_field_definitions f
        WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.api_name=$3 AND f.deleted_at IS NULL`,
      [tenantId,targetObject,targetField]);
      const definition=field.rows[0];
      if(!definition)throw new Error('Formula references an unknown field: '+reference);
      if(definition.data_type==='encryptedtext')
        throw new Error('Formula fields cannot reference encrypted fields');
      const type=formulaTypeForField(definition.data_type,definition.formula_return_type,
        definition.rollup_source_type);
      if(!type)throw new Error('Formula references an unsupported field type: '+reference);
      referenceTypes.set(reference,type);
      publicReferences.push({objectApi:targetObject,fieldApi:targetField});
    }
    const inferred=inferFlowFormulaType(expression,reference=>referenceTypes.get(reference)??null);
    const expected=['currency','percent'].includes(normalizedReturnType)?'Number':
      normalizedReturnType==='datetime'?'DateTime':
        normalizedReturnType[0].toUpperCase()+normalizedReturnType.slice(1);
    if(inferred!=='Null'&&inferred!==expected&&!(expected==='Text'&&inferred==='Picklist'))
      throw new Error('Formula result does not match return type');
    return publicReferences;
  }
  async register(tenantId:string,apiName:string,label:string,isSystem=false) {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)||!label.trim())throw new Error('Invalid object definition');
    const {rows}=await this.db.query<{id:string}>(
      'INSERT INTO md_object_definitions (tenant_id,api_name,label,is_system) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,api_name) DO UPDATE SET label=EXCLUDED.label RETURNING id',
      [tenantId,apiName,label,isSystem]);
    return rows[0];
  }
  // Atomic tenant-scoped creation: no partially created Objects when a field is invalid.
  async create(tenantId:string,apiName:string,label:string,fields:unknown[],
    persistSupplemental?:(client:PoolClient)=>Promise<void>) {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)||!label.trim())throw new Error('Invalid object definition');
    if(!Array.isArray(fields))throw new Error('Invalid object fields');
    const normalized=fields.map((raw:unknown)=>{
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid field definition');
      return parseFieldDefinition(raw as Record<string,unknown>,apiName);
    });
    if(new Set(normalized.map(x=>x.apiName.toLowerCase())).size!==normalized.length)
      throw new Error('Duplicate field API name');
    if(new Set(normalized.filter(f=>f.relationshipType!==null)
      .map(f=>String(f.relatedObject).toLowerCase()+':'+String(f.childRelationshipName).toLowerCase())).size
      !==normalized.filter(f=>f.relationshipType!==null).length)
      throw new Error('Duplicate child relationship name for target object');
    if(normalized.filter(field=>field.relationshipType==='Master-Detail').length>2)
      throw new Error('An object cannot have more than two Master-Detail relationships');
    if(normalized.some(field=>field.relationshipType==='Master-Detail'&&field.relatedObject===apiName))
      throw new Error('Master-Detail relationships cannot create a cycle');
    if(normalized.some(field=>field.relationshipType==='Hierarchical'
      &&(apiName!=='User'||field.relatedObject!=='User')))
      throw new Error('Hierarchical relationships are supported only as User self-lookups');
    await this.db.transaction(async client=>{
      // A tenant-scoped schema lock serializes simultaneous edge creation and prevents
      // concurrent A->B / B->A master-detail cycles from both passing validation.
      if(normalized.some(field=>field.relationshipType==='Master-Detail'))
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,21102))',[tenantId]);
      await requireAvailableMetadataName(client,tenantId,'object',apiName);
      const inserted=await client.query(
        'INSERT INTO md_object_definitions (tenant_id,api_name,label,is_system) VALUES ($1,$2,$3,false) ON CONFLICT (tenant_id,api_name) DO NOTHING RETURNING id',
        [tenantId,apiName,label]);
      if(!inserted.rowCount)throw new Error('Object already exists');
      for(const field of normalized){
        if(field.rollup)throw new Error('Roll-Up Summary fields must be added after both related objects exist');
        if(field.globalValueSetApiName){
          const values=await client.query<{value:string}>(`
            SELECT v.value FROM md_global_value_sets s
            JOIN md_global_value_set_values v ON v.tenant_id=s.tenant_id AND v.value_set_id=s.id
            WHERE s.tenant_id=$1 AND s.api_name=$2 AND v.active ORDER BY v.sort_order,v.value`,
          [tenantId,field.globalValueSetApiName]);
          if(!values.rowCount)throw new Error('Global Value Set not found or has no active values');
          field.picklistValues=values.rows.map(row=>row.value);
        }
        if(field.controllerFieldApiName){
          const controller=normalized.find(item=>item.apiName===field.controllerFieldApiName);
          if(field.controllerFieldApiName===field.apiName||!controller||!['picklist','boolean'].includes(controller.dataType))
            throw new Error('Invalid dependent picklist controller');
          const controllerValues=controller.dataType==='boolean'?['true','false']:
            controller.globalValueSetApiName
              ?(await client.query<{value:string}>(`SELECT v.value FROM md_global_value_sets s
                JOIN md_global_value_set_values v ON v.tenant_id=s.tenant_id AND v.value_set_id=s.id
                WHERE s.tenant_id=$1 AND s.api_name=$2 AND v.active`,
              [tenantId,controller.globalValueSetApiName])).rows.map(row=>row.value)
              :controller.picklistValues;
          if(Object.keys(field.valueSettings).some(value=>!controllerValues.includes(value)))
            throw new Error('Invalid dependent picklist controller value');
          if(Object.values(field.valueSettings).some(values=>values.some(value=>!field.picklistValues.includes(value))))
            throw new Error('Invalid dependent picklist value');
        }
        await client.query(`INSERT INTO md_field_definitions
          (tenant_id,object_api,api_name,data_type,related_object,required,max_length,label,picklist_restricted,
           relationship_type,is_unique,external_id,case_sensitive,default_value,help_text,description,
           precision,scale,formula_expression,formula_return_type,auto_number_format,
           rollup_child_object,rollup_relationship_field,rollup_operation,rollup_source_field,
           relationship_name,child_relationship_name,delete_behavior,allow_reparenting)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
          [tenantId,apiName,field.apiName,field.dataType,field.relatedObject,field.required,field.maxLength,
            field.label,field.restricted,field.relationshipType,field.unique,field.externalId,
            field.caseSensitive,field.defaultValue,field.helpText,field.description,field.precision,field.scale,
            field.formulaExpression,field.formulaReturnType,field.autoNumberFormat,
            null,null,null,null,
            field.relationshipName,field.childRelationshipName,field.deleteBehavior,field.allowReparenting]);
        if(field.trackHistory)await client.query(
          'UPDATE md_field_definitions SET track_history=true WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3',
          [tenantId,apiName,field.apiName]);
        if(field.formulaExpression&&field.formulaReturnType)await client.query(`
          INSERT INTO md_field_formulas(tenant_id,object_api,field_api,expression,return_type)
          VALUES($1,$2,$3,$4,$5)`,
        [tenantId,apiName,field.apiName,field.formulaExpression,field.formulaReturnType]);
        if(field.globalValueSetApiName)await client.query(`INSERT INTO md_field_global_value_sets
          (tenant_id,object_api,field_api,value_set_api) VALUES($1,$2,$3,$4)`,
        [tenantId,apiName,field.apiName,field.globalValueSetApiName]);
        else for(const [order,value] of field.picklistValues.entries())
          await client.query('INSERT INTO md_field_picklist_values(tenant_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5)',
            [tenantId,apiName,field.apiName,value,order]);
      }
      for(const field of normalized)if(field.formulaExpression&&field.formulaReturnType)
        await this.validateFormulaWithin(client,tenantId,apiName,field.formulaExpression,
          field.formulaReturnType,field.apiName);
      for(const field of normalized)if(field.controllerFieldApiName){
        await client.query(`INSERT INTO md_field_dependencies
          (tenant_id,object_api,field_api,controller_field_api)
          VALUES($1,$2,$3,$4)`,[tenantId,apiName,field.apiName,field.controllerFieldApiName]);
        for(const [controllerValue,values] of Object.entries(field.valueSettings))
          for(const value of values)await client.query(`INSERT INTO md_field_dependency_values
            (tenant_id,object_api,field_api,controller_value,picklist_value)
            VALUES($1,$2,$3,$4,$5)`,[tenantId,apiName,field.apiName,controllerValue,value]);
      }
      // Create the first Page Layout together with its object and fields.
      await client.query('INSERT INTO md_object_page_layouts (tenant_id,object_api,layout_id,label,sort_order) VALUES ($1,$2,$3,$4,0)',
        [tenantId,apiName,'default',label+' Layout']);
      await client.query(`INSERT INTO md_object_page_layout_sections
        (tenant_id,object_api,layout_id,section_id,label,columns,sort_order)
        VALUES ($1,$2,'default','details','Record Information',2,0)`,[tenantId,apiName]);
      for(const [sortOrder,field] of normalized.entries())await client.query(`INSERT INTO md_object_page_layout_fields
        (tenant_id,object_api,layout_id,section_id,field_api,sort_order)
        VALUES ($1,$2,'default','details',$3,$4)`,[tenantId,apiName,field.apiName,sortOrder]);
      for(const [sortOrder,action] of ['New','Edit','Delete'].entries())await client.query(`INSERT INTO md_object_page_layout_actions
        (tenant_id,object_api,layout_id,action_name,sort_order)
        VALUES ($1,$2,'default',$3,$4)`,[tenantId,apiName,action,sortOrder]);
      await client.query(`INSERT INTO md_object_record_types
        (tenant_id,object_api,record_type_id,developer_name,label,active,is_default,sort_order)
        VALUES ($1,$2,'master','Master','Master',true,true,0)`,[tenantId,apiName]);
      if(persistSupplemental)await persistSupplemental(client);
    });
    return this.get(tenantId,apiName);
  }
  async addField(tenantId:string,objectApi:string,fieldApi:string,dataType:string,relatedObject?:string,label?:string,settings?:Record<string,unknown>,persistSupplemental?:(client:PoolClient)=>Promise<void>) {
    const field=parseFieldDefinition({...(settings??{}),apiName:fieldApi,dataType,relatedObject:settings?.relationship??relatedObject,label:label??settings?.label},objectApi);
    if(field.relationshipType==='Hierarchical'&&(objectApi!=='User'||field.relatedObject!=='User'))
      throw new Error('Hierarchical relationships are supported only as User self-lookups');
    const formula=field.dataType==='formula'&&field.formulaExpression
      ?{expression:field.formulaExpression,returnType:field.formulaReturnType??'Text'}:null;
    const result=await this.db.transaction(async client=>{
      await requireAvailableMetadataName(client,tenantId,'field',field.apiName,{objectApi});
      if(formula){
        await this.validateFormulaWithin(client,tenantId,objectApi,formula.expression,
          formula.returnType,fieldApi);
        const refs=[...formula.expression.matchAll(/@([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)/g)];
        for(const [,targetObject,targetField] of refs){
          const target=await client.query<{data_type:string}>(
            `SELECT data_type FROM md_field_definitions
             WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
            [tenantId,targetObject,targetField]);
          if(target.rows[0]?.data_type==='encryptedtext')
            throw new Error('Formula fields cannot reference encrypted fields');
        }
      }
      if(field.globalValueSetApiName){
        const values=await client.query<{value:string}>(`
          SELECT v.value FROM md_global_value_sets s
          JOIN md_global_value_set_values v ON v.tenant_id=s.tenant_id AND v.value_set_id=s.id
          WHERE s.tenant_id=$1 AND s.api_name=$2 AND v.active ORDER BY v.sort_order,v.value`,
        [tenantId,field.globalValueSetApiName]);
        if(!values.rowCount)throw new Error('Global Value Set not found or has no active values');
        field.picklistValues=values.rows.map(row=>row.value);
      }
      if(field.rollup)await validateRollupWithin(client,tenantId,objectApi,field.rollup);
      if(field.relationshipType==='Master-Detail'){
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,21102))',[tenantId]);
        const cycle=await client.query(`WITH RECURSIVE parent_chain(object_api,path) AS (
          SELECT $3::text,ARRAY[$3::text]
          UNION ALL
          SELECT f.related_object,parent_chain.path||f.related_object
          FROM parent_chain
          JOIN md_field_definitions f ON f.tenant_id=$1 AND f.object_api=parent_chain.object_api
            AND f.relationship_type='Master-Detail' AND f.deleted_at IS NULL
          WHERE f.related_object IS NOT NULL AND NOT f.related_object=ANY(parent_chain.path)
        ) SELECT 1 FROM parent_chain WHERE object_api=$2 LIMIT 1`,
        [tenantId,objectApi,field.relatedObject]);
        if(cycle.rowCount)throw new Error('Master-Detail relationships cannot create a cycle');
        const parents=await client.query(`SELECT count(*)::integer AS total FROM md_field_definitions
          WHERE tenant_id=$1 AND object_api=$2 AND relationship_type='Master-Detail' AND deleted_at IS NULL`,
        [tenantId,objectApi]);
        if(Number(parents.rows[0]?.total??0)>=2)
          throw new Error('An object cannot have more than two Master-Detail relationships');
      }
      if(field.controllerFieldApiName){
        const controller=await client.query<{data_type:string}>(`SELECT data_type FROM md_field_definitions
          WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
        [tenantId,objectApi,field.controllerFieldApiName]);
        if(!controller.rows[0]||!['picklist','boolean'].includes(controller.rows[0].data_type))
          throw new Error('Invalid dependent picklist controller');
        const options=controller.rows[0].data_type==='boolean'
          ?['true','false']:await loadPicklistValues(client,tenantId,objectApi,field.controllerFieldApiName);
        if(Object.keys(field.valueSettings).some(value=>!options.includes(value))||
          Object.values(field.valueSettings).some(values=>values.some(value=>!field.picklistValues.includes(value))))
          throw new Error('Invalid dependent picklist values');
      }
      const inserted=await client.query(`
        INSERT INTO md_field_definitions
          (tenant_id,object_api,api_name,data_type,related_object,max_length,label,picklist_restricted,
           required,relationship_type,is_unique,external_id,case_sensitive,default_value,help_text,description,
           precision,scale,formula_expression,formula_return_type,auto_number_format,
           rollup_child_object,rollup_relationship_field,rollup_operation,rollup_source_field,rollup_filter_logic,
           relationship_name,child_relationship_name,delete_behavior,allow_reparenting)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
        ON CONFLICT (tenant_id,object_api,api_name) DO NOTHING RETURNING id
      `,[tenantId,objectApi,field.apiName,field.dataType,field.relatedObject,field.maxLength,field.label,
         field.restricted,field.required,field.relationshipType,field.unique,field.externalId,
         field.caseSensitive,field.defaultValue,field.helpText,field.description,field.precision,field.scale,
         field.formulaExpression,field.formulaReturnType,field.autoNumberFormat,
         field.rollup?.childObject??null,field.rollup?.relationshipField??null,field.rollup?.operation??null,
         field.rollup?.sourceField??null,field.rollup?.filterLogic??'All',
         field.relationshipName,field.childRelationshipName,field.deleteBehavior,field.allowReparenting]);
      if(!inserted.rowCount)throw new Error('Field already exists');
      if(field.trackHistory)await client.query(
        'UPDATE md_field_definitions SET track_history=true WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3',
        [tenantId,objectApi,field.apiName]);
      if(field.globalValueSetApiName)await client.query(`INSERT INTO md_field_global_value_sets
        (tenant_id,object_api,field_api,value_set_api) VALUES($1,$2,$3,$4)`,
      [tenantId,objectApi,fieldApi,field.globalValueSetApiName]);
      else for(const [order,value] of field.picklistValues.entries())await client.query(
          'INSERT INTO md_field_picklist_values(tenant_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5)',
          [tenantId,objectApi,fieldApi,value,order]);
      if(field.rollup)for(const [sortOrder,filter] of field.rollup.filters.entries())
        await client.query(`INSERT INTO md_field_rollup_filters
          (tenant_id,object_api,child_object,rollup_field_api,filter_field_api,operator,value_text,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId,objectApi,field.rollup.childObject,field.apiName,filter.fieldApiName,
          filter.operator,filter.value,sortOrder]);
      if(field.controllerFieldApiName){
        await client.query(`INSERT INTO md_field_dependencies
          (tenant_id,object_api,field_api,controller_field_api)
          VALUES($1,$2,$3,$4)`,[tenantId,objectApi,fieldApi,field.controllerFieldApiName]);
        for(const [controllerValue,values] of Object.entries(field.valueSettings))
          for(const value of values)await client.query(`INSERT INTO md_field_dependency_values
            (tenant_id,object_api,field_api,controller_value,picklist_value)
            VALUES($1,$2,$3,$4,$5)`,[tenantId,objectApi,fieldApi,controllerValue,value]);
      }
      if(formula)await client.query(`
        INSERT INTO md_field_formulas(tenant_id,object_api,field_api,expression,return_type)
        VALUES($1,$2,$3,$4,$5)`,
        [tenantId,objectApi,fieldApi,formula.expression,formula.returnType]);
      if(persistSupplemental)await persistSupplemental(client);
      return inserted;
    });
    return result;
  }
  /** Only mutable SQL-backed field properties may be edited; unsupported options fail closed. */
  async updateField(tenantId:string,objectApi:string,fieldApi:string,proposal:Record<string,unknown>,actorUserId:string|null=null){
    if(typeof proposal.label!=='string'||!proposal.label.trim()||proposal.label.length>160
      || (proposal.apiName!==undefined&&proposal.apiName!==fieldApi))
      throw new Error('Invalid field update');
    const label=proposal.label.trim();
    const original=await this.get(tenantId,objectApi);
    const current=original.fields.find(x=>x.apiName===fieldApi);
    if(!current)throw new Error('Field not found');
    const changesDataType=proposal.dataType!==undefined
      &&fieldTypeSignature(String(proposal.dataType)).dataType!==fieldTypeSignature(current.dataType).dataType;
    const mutable=new Set(['id','apiName','label','dataType','required','unique','externalId','caseSensitive',
      'defaultValue','helpText','description','relationship','formula','picklistValues','picklistRestricted',
      'controllerFieldApiName','valueSettings','globalValueSetApiName','rollup','autoNumberFormat','trackHistory']);
    const completeField=proposal.dataType!==undefined;
    const proposedController=Object.hasOwn(proposal,'controllerFieldApiName')
      ?proposal.controllerFieldApiName:completeField?null:current.controllerFieldApiName??null;
    if(proposedController!==null&&typeof proposedController!=='string')
      throw new Error('Invalid dependent picklist controller');
    const proposedSettings=Object.hasOwn(proposal,'valueSettings')
      ?proposal.valueSettings:proposedController?current.valueSettings??{}:undefined;
    if(Object.keys(proposal).some(key=>!mutable.has(key))||
      (!changesDataType&&proposal.formula!==undefined&&JSON.stringify(proposal.formula)!==JSON.stringify(current.formula))||
      (!changesDataType&&proposal.rollup!==undefined&&JSON.stringify(proposal.rollup)!==JSON.stringify(current.rollup)))
      throw new Error('Unsupported field update requires a metadata migration');
    for(const key of ['required','unique','externalId','caseSensitive','trackHistory'])
      if(proposal[key]!==undefined&&typeof proposal[key]!=='boolean')
        throw new Error('Invalid field update');
    if(proposal.helpText!==undefined&&(typeof proposal.helpText!=='string'||proposal.helpText.length>255))
      throw new Error('Invalid field help text');
    if(proposal.description!==undefined&&(typeof proposal.description!=='string'||proposal.description.length>1000))
      throw new Error('Invalid field description');
    if(proposal.defaultValue!==undefined&&proposal.defaultValue!==null
      &&!['string','number','boolean'].includes(typeof proposal.defaultValue))
      throw new Error('Invalid field default value');
    if(proposal.picklistRestricted!==undefined&&typeof proposal.picklistRestricted!=='boolean')
      throw new Error('Invalid picklist restriction');
    const field=parseFieldDefinition({
      ...proposal,apiName:fieldApi,dataType:proposal.dataType??current.dataType,label,
      unique:proposal.unique??current.unique,
      externalId:proposal.externalId??current.externalId,
      caseSensitive:proposal.caseSensitive??current.caseSensitive,
      picklistValues:proposal.picklistValues??current.picklistValues,
      picklistRestricted:proposal.picklistRestricted??current.picklistRestricted,
      valueSettings:proposedController?proposedSettings:undefined,
      globalValueSetApiName:changesDataType&&!['picklist','multipicklist'].includes(
        fieldTypeSignature(String(proposal.dataType)).dataType)?null:
          Object.hasOwn(proposal,'globalValueSetApiName')
            ?proposal.globalValueSetApiName:current.globalValueSetApiName??null,
      controllerFieldApiName:changesDataType&&!['picklist'].includes(
        fieldTypeSignature(String(proposal.dataType)).dataType)?undefined:proposedController??undefined,
      relationship:changesDataType?proposal.relationship:proposal.relationship??current.relationship,
      formula:changesDataType?proposal.formula:proposal.formula??current.formula,
      defaultValue:proposal.defaultValue===undefined?current.defaultValue:proposal.defaultValue
    },objectApi);
    if(field.relationshipType==='Hierarchical'&&(objectApi!=='User'||field.relatedObject!=='User'))
      throw new Error('Hierarchical relationships are supported only as User self-lookups');
    if(field.dataType==='encryptedtext'&&(proposal.trackHistory===true
      ||(proposal.trackHistory===undefined&&current.trackHistory)))
      throw new Error('Encrypted fields cannot be tracked in plaintext history');
    const globalValueSetChanged=field.globalValueSetApiName!==(current.globalValueSetApiName??null);
    if(changesDataType&&field.globalValueSetApiName)
      throw new Error('Type migrations to a Global Value Set require local picklist values first');
    const targetUsesPicklist=['picklist','multipicklist'].includes(field.dataType);
    const currentUsesPicklist=['picklist','multipicklist'].includes(
      fieldTypeSignature(current.dataType).dataType);
    const picklistValuesChanged=targetUsesPicklist&&!field.globalValueSetApiName
      &&(!currentUsesPicklist||globalValueSetChanged
        ||JSON.stringify(field.picklistValues)!==JSON.stringify(current.picklistValues??[]));
    const dependencyChanged=field.controllerFieldApiName!== (current.controllerFieldApiName??null)
      ||Boolean(field.controllerFieldApiName&&JSON.stringify(normalizeValueSettings(field.valueSettings))!==
        JSON.stringify(normalizeValueSettings(current.valueSettings)));
    const required=proposal.required===undefined?current.required:proposal.required===true;
    if(field.relationshipType==='Master-Detail'&&proposal.required===false)
      throw new Error('Master-Detail relationship fields must be required');
    const effectiveRequired=field.relationshipType==='Master-Detail'||required;
    const unique=proposal.unique===undefined?current.unique:proposal.unique===true;
    const externalId=proposal.externalId===undefined?current.externalId:proposal.externalId===true;
    const caseSensitive=proposal.caseSensitive===undefined?current.caseSensitive:proposal.caseSensitive===true;
    const oldType=fieldTypeSignature(current.dataType);
    const relationshipDefinitionChanged=field.dataType==='reference'&&(
      field.relatedObject!==(current.relationship?.targetObject??null)
      ||field.relationshipType!==(current.relationship?.type??null)
      ||field.relationshipName!==(current.relationship?.relationshipName??null)
      ||field.childRelationshipName!==(current.relationship?.childRelationshipName??null)
      ||field.deleteBehavior!==(current.relationship?.deleteBehavior??null)
      ||field.allowReparenting!==(current.relationship?.allowReparenting??false));
    const formulaReturnTypeChanged=field.dataType==='formula'
      &&field.formulaReturnType!== (current.formula?.returnType??null);
    const rollupDefinitionChanged=field.dataType==='rollup'
      &&JSON.stringify(field.rollup)!==JSON.stringify(current.rollup??null);
    const typeDefinitionChanged=field.dataType!==oldType.dataType||field.maxLength!==oldType.maxLength
      ||field.precision!==oldType.precision||field.scale!==oldType.scale
      ||relationshipDefinitionChanged||formulaReturnTypeChanged||rollupDefinitionChanged;
    const defaultValue=field.defaultValue;
    const migrationTarget:FieldTypeTarget={
      dataType:field.dataType,maxLength:field.maxLength,precision:field.precision,scale:field.scale,
      required:effectiveRequired,unique,externalId,caseSensitive,defaultValue,
      relatedObject:field.relatedObject,relationshipType:field.relationshipType,
      globalValueSetApiName:field.globalValueSetApiName,
      controllerFieldApiName:field.controllerFieldApiName,
      relationshipName:field.relationshipName,childRelationshipName:field.childRelationshipName,
      deleteBehavior:field.deleteBehavior,allowReparenting:field.allowReparenting,
      picklistValues:field.picklistValues,picklistRestricted:field.restricted,
      formulaExpression:field.formulaExpression,formulaReturnType:field.formulaReturnType,
      autoNumberFormat:field.autoNumberFormat,rollup:field.rollup
    };
    const migrationSource:FieldTypeTarget={
      dataType:oldType.dataType,maxLength:oldType.maxLength,precision:oldType.precision,scale:oldType.scale,
      required:current.required,unique:current.unique,externalId:current.externalId,
      caseSensitive:current.caseSensitive,defaultValue:current.defaultValue==null?null:String(current.defaultValue),
      relatedObject:current.relationship?.targetObject??null,
      globalValueSetApiName:current.globalValueSetApiName??null,
      controllerFieldApiName:current.controllerFieldApiName??null,
      relationshipType:current.relationship?.type??null,
      relationshipName:current.relationship?.relationshipName??null,
      childRelationshipName:current.relationship?.childRelationshipName??null,
      deleteBehavior:current.relationship?.deleteBehavior??null,
      allowReparenting:current.relationship?.allowReparenting??false,
      picklistValues:current.picklistValues??[],picklistRestricted:current.picklistRestricted!==false,
      formulaExpression:current.formula?.expression??null,formulaReturnType:current.formula?.returnType??null,
      autoNumberFormat:current.autoNumberFormat??null,
      rollup:current.rollup?.childObject&&current.rollup.relationshipField
        &&['COUNT','SUM','MIN','MAX'].includes(current.rollup.operation??'')
        ?{childObject:current.rollup.childObject,relationshipField:current.rollup.relationshipField,
          operation:current.rollup.operation as 'COUNT'|'SUM'|'MIN'|'MAX',
          sourceField:current.rollup.sourceField??null,
          filterLogic:current.rollup.filterLogic==='Any'?'Any':'All',filters:current.rollup.filters??[]}
        :null
    };
    let fieldTypeMigrationId:string|null=null;
    await this.db.transaction(async client=>{
      if(typeDefinitionChanged){
        if(oldType.dataType==='richtext'&&field.dataType!=='richtext'){
          const files=await client.query(`SELECT 1 FROM md_record_files
            WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 LIMIT 1`,
          [tenantId,objectApi,fieldApi]);
          if(files.rowCount)
            throw new Error('Inline images must be removed before migrating a Rich Text field');
        }
        if(field.rollup)await validateRollupWithin(client,tenantId,objectApi,field.rollup);
        if(field.globalValueSetApiName)
          throw new Error('Type migrations to a Global Value Set require local picklist values first');
        if(field.controllerFieldApiName||current.controllerFieldApiName)
          throw new Error('Dependent picklist fields must be unlinked before changing their type');
        if(field.relationshipType==='Master-Detail'){
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,21102))',[tenantId]);
          const cycle=await client.query(`WITH RECURSIVE parent_chain(object_api,path) AS (
            SELECT $3::text,ARRAY[$3::text]
            UNION ALL
            SELECT f.related_object,parent_chain.path||f.related_object
            FROM parent_chain JOIN md_field_definitions f
              ON f.tenant_id=$1 AND f.object_api=parent_chain.object_api
              AND f.relationship_type='Master-Detail' AND f.deleted_at IS NULL
            WHERE f.related_object IS NOT NULL AND NOT f.related_object=ANY(parent_chain.path)
          ) SELECT 1 FROM parent_chain WHERE object_api=$2 LIMIT 1`,
          [tenantId,objectApi,field.relatedObject]);
          if(cycle.rowCount)throw new Error('Master-Detail relationships cannot create a cycle');
          const parentCount=await client.query<{total:number}>(`SELECT count(*)::integer AS total
            FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2
              AND relationship_type='Master-Detail' AND deleted_at IS NULL AND api_name<>$3`,
          [tenantId,objectApi,fieldApi]);
          if(Number(parentCount.rows[0]?.total??0)>=2)
            throw new Error('An object cannot have more than two Master-Detail relationships');
        }
        fieldTypeMigrationId=await applyFieldTypeMigration(client,tenantId,objectApi,fieldApi,
          actorUserId,migrationSource,migrationTarget,this.migrationRuntime);
      }
      if(field.dataType==='formula')
        await this.validateFormulaWithin(client,tenantId,objectApi,field.formulaExpression!,
          field.formulaReturnType??'Text',fieldApi);
      if(field.globalValueSetApiName){
        const values=await client.query<{value:string}>(`
          SELECT v.value FROM md_global_value_sets s
          JOIN md_global_value_set_values v ON v.tenant_id=s.tenant_id AND v.value_set_id=s.id
          WHERE s.tenant_id=$1 AND s.api_name=$2 AND v.active ORDER BY v.sort_order,v.value`,
        [tenantId,field.globalValueSetApiName]);
        if(!values.rowCount)throw new Error('Global Value Set not found or has no active values');
        field.picklistValues=values.rows.map(row=>row.value);
      }
      if(globalValueSetChanged&&field.globalValueSetApiName){
        const existing=await client.query<{value_text:string|null}>(`
          SELECT value_text FROM md_record_values WHERE tenant_id=$1 AND object_api=$2
            AND field_api=$3 AND value_text IS NOT NULL`,
        [tenantId,objectApi,fieldApi]);
        const allowed=new Set(field.picklistValues);
        if(existing.rows.some(row=>{
          const values=current.dataType==='multipicklist'?(row.value_text??'').split(';'):[row.value_text??''];
          return values.some(value=>value&&!allowed.has(value));
        }))throw new Error('Global Value Set does not contain existing record values');
      }
      if(required&&!current.required){
        const valueIsPresent=field.dataType==='reference'?'v.reference_record_id IS NOT NULL':
          field.dataType==='geolocation'?'v.geo_latitude IS NOT NULL AND v.geo_longitude IS NOT NULL':
          field.dataType==='address'?'COALESCE(v.address_street,v.address_city,v.address_state,v.address_postal_code,v.address_country) IS NOT NULL':
          'v.value_text IS NOT NULL';
        const missing=await client.query(`SELECT 1 FROM md_records r
          WHERE r.tenant_id=$1 AND r.object_api=$2 AND NOT EXISTS(
            SELECT 1 FROM md_record_values v WHERE v.tenant_id=r.tenant_id
              AND v.record_id=r.id AND v.field_api=$3 AND (${valueIsPresent}))
          LIMIT 1`,[tenantId,objectApi,fieldApi]);
        if(missing.rowCount)throw new Error('Required field cannot be enabled while records have no value');
      }
      if(field.controllerFieldApiName){
        const controller=await client.query<{data_type:string}>(`SELECT data_type FROM md_field_definitions
          WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
        [tenantId,objectApi,field.controllerFieldApiName]);
        if(field.controllerFieldApiName===fieldApi||!controller.rows[0]
          ||!['picklist','boolean'].includes(controller.rows[0].data_type))
          throw new Error('Invalid dependent picklist controller');
        const controllerValues=controller.rows[0].data_type==='boolean'
          ?['true','false']:await loadPicklistValues(client,tenantId,objectApi,field.controllerFieldApiName);
        if(Object.keys(field.valueSettings).some(value=>!controllerValues.includes(value))
          ||Object.values(field.valueSettings).some(values=>values.some(value=>!field.picklistValues.includes(value))))
          throw new Error('Invalid dependent picklist values');
        if(dependencyChanged){
          const existing=await client.query<{controller_value:string|null;dependent_value:string|null}>(`
            SELECT controller.value_text AS controller_value,dependent.value_text AS dependent_value
            FROM md_records r
            JOIN md_record_values dependent ON dependent.tenant_id=r.tenant_id AND dependent.record_id=r.id
              AND dependent.field_api=$3
            LEFT JOIN md_record_values controller ON controller.tenant_id=r.tenant_id
              AND controller.record_id=r.id AND controller.field_api=$4
            WHERE r.tenant_id=$1 AND r.object_api=$2
          `,[tenantId,objectApi,fieldApi,field.controllerFieldApiName]);
          if(existing.rows.some(row=>row.dependent_value!==null
            &&!field.valueSettings[row.controller_value??'']?.includes(row.dependent_value)))
            throw new Error('Dependent picklist update conflicts with existing record values');
        }
      }
      if(globalValueSetChanged){
        await client.query(`DELETE FROM md_field_global_value_sets
          WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
        if(field.globalValueSetApiName){
          await client.query(`DELETE FROM md_field_picklist_values
            WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
          await client.query(`INSERT INTO md_field_global_value_sets
            (tenant_id,object_api,field_api,value_set_api) VALUES($1,$2,$3,$4)`,
          [tenantId,objectApi,fieldApi,field.globalValueSetApiName]);
        }
      }
      if(picklistValuesChanged){
        const removed=(current.picklistValues??[]).filter(value=>!field.picklistValues.includes(value));
        if(removed.length){
          const inUse=currentUsesPicklist&&current.dataType.toLowerCase().replace(/[\s-]/g,'')==='multipicklist'
            ?await client.query(`SELECT 1 FROM md_record_values
              WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 AND EXISTS(
                SELECT 1 FROM unnest(string_to_array(value_text,';')) selected(value)
                WHERE selected.value=ANY($4::text[])) LIMIT 1`,
            [tenantId,objectApi,fieldApi,removed])
            :await client.query(`SELECT 1 FROM md_record_values
              WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3
                AND value_text=ANY($4::text[]) LIMIT 1`,[tenantId,objectApi,fieldApi,removed]);
          if(inUse.rowCount)throw new Error('Picklist values cannot be removed while records use them');
        }
      }
      const changed=await client.query(`UPDATE md_field_definitions SET
        label=$4,data_type=$5,max_length=$6,precision=$7,scale=$8,required=$9,
        is_unique=$10,external_id=$11,case_sensitive=$12,
        default_value=$13,help_text=$14,description=$15,picklist_restricted=$16,
        relationship_name=$17,child_relationship_name=$18,delete_behavior=$19,allow_reparenting=$20,
        related_object=$21,relationship_type=$22,rollup_child_object=$23,
        rollup_relationship_field=$24,rollup_operation=$25,rollup_source_field=$26,
        auto_number_format=$27,formula_expression=$28,formula_return_type=$29,rollup_filter_logic=$30
        WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 RETURNING id`,
      [tenantId,objectApi,fieldApi,label,field.dataType,field.maxLength,field.precision,field.scale,
        effectiveRequired,unique,externalId,caseSensitive,defaultValue,
        proposal.helpText===undefined?current.helpText:proposal.helpText||null,
        proposal.description===undefined?current.description:proposal.description||null,field.restricted,
        field.relationshipName,field.childRelationshipName,field.deleteBehavior,field.allowReparenting,
        field.relatedObject,field.relationshipType,field.rollup?.childObject??null,
        field.rollup?.relationshipField??null,field.rollup?.operation??null,field.rollup?.sourceField??null,
        field.autoNumberFormat,field.formulaExpression,field.formulaReturnType,
        field.rollup?.filterLogic??'All']);
      if(!changed.rowCount)throw new Error('Field not found');
      if(proposal.trackHistory!==undefined)await client.query(
        'UPDATE md_field_definitions SET track_history=$4 WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3',
        [tenantId,objectApi,fieldApi,proposal.trackHistory]);
      if(typeDefinitionChanged){
        await client.query(`DELETE FROM md_field_rollup_filters
          WHERE tenant_id=$1 AND object_api=$2 AND rollup_field_api=$3`,[tenantId,objectApi,fieldApi]);
        if(field.rollup)for(const [sortOrder,filter] of field.rollup.filters.entries())
          await client.query(`INSERT INTO md_field_rollup_filters
            (tenant_id,object_api,child_object,rollup_field_api,filter_field_api,operator,value_text,sort_order)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tenantId,objectApi,field.rollup.childObject,fieldApi,filter.fieldApiName,
            filter.operator,filter.value,sortOrder]);
      }
      await client.query(`DELETE FROM md_field_formulas
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
      if(field.dataType==='formula')await client.query(`INSERT INTO md_field_formulas
        (tenant_id,object_api,field_api,expression,return_type)
        VALUES($1,$2,$3,$4,$5)`,
      [tenantId,objectApi,fieldApi,field.formulaExpression,field.formulaReturnType??'Text']);
      if(picklistValuesChanged){
        await client.query('DELETE FROM md_field_picklist_values WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
          [tenantId,objectApi,fieldApi]);
        if(!globalValueSetChanged)for(const [order,value] of field.picklistValues.entries())await client.query(
          'INSERT INTO md_field_picklist_values(tenant_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5)',
          [tenantId,objectApi,fieldApi,value,order]);
      }
      if(!targetUsesPicklist){
        await client.query('DELETE FROM md_field_picklist_values WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
          [tenantId,objectApi,fieldApi]);
      }
      if(dependencyChanged){
        await client.query('DELETE FROM md_field_dependencies WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
          [tenantId,objectApi,fieldApi]);
        if(field.controllerFieldApiName){
          await client.query(`INSERT INTO md_field_dependencies
            (tenant_id,object_api,field_api,controller_field_api) VALUES($1,$2,$3,$4)`,
          [tenantId,objectApi,fieldApi,field.controllerFieldApiName]);
          for(const [controllerValue,values] of Object.entries(field.valueSettings))
            for(const value of values)await client.query(`INSERT INTO md_field_dependency_values
              (tenant_id,object_api,field_api,controller_value,picklist_value)
              VALUES($1,$2,$3,$4,$5)`,[tenantId,objectApi,fieldApi,controllerValue,value]);
        }
      }
      await client.query(`UPDATE md_record_values SET is_unique=$4,case_sensitive=$5
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
      [tenantId,objectApi,fieldApi,unique,caseSensitive]);
      if(typeDefinitionChanged&&field.dataType==='rollup'){
        if(!this.migrationRuntime.recalculateRollup)
          throw new Error('Roll-Up Summary migration requires the shared record runtime');
        await this.migrationRuntime.recalculateRollup(client,tenantId,objectApi,fieldApi);
        await client.query(`UPDATE md_field_type_migration_values m SET
            after_value_text=v.value_text,after_value_number=v.value_number::text,
            after_value_boolean=v.value_boolean,after_value_date=v.value_date::text,
            after_value_datetime=v.value_datetime,after_reference_record_id=v.reference_record_id,
            after_geo_latitude=v.geo_latitude,after_geo_longitude=v.geo_longitude,
            after_address_street=v.address_street,after_address_city=v.address_city,
            after_address_state=v.address_state,after_address_postal_code=v.address_postal_code,
            after_address_country=v.address_country,after_value_exists=true
          FROM md_record_values v WHERE m.tenant_id=$1 AND m.migration_id=$4
            AND v.tenant_id=m.tenant_id AND v.record_id=m.record_id
            AND v.object_api=m.object_api AND v.field_api=$3`,
        [tenantId,objectApi,fieldApi,fieldTypeMigrationId]);
      }
    });
    return this.get(tenantId,objectApi);
  }
  async listFieldTypeMigrations(tenantId:string,objectApi:string,fieldApi:string){
    const {rows}=await this.db.query<{
      id:string;from_data_type:string;to_data_type:string;status:string;records_migrated:number;
      created_at:Date;rolled_back_at:Date|null;actor_user_id:string|null
    }>(`SELECT id,from_data_type,to_data_type,status,records_migrated,created_at,rolled_back_at,actor_user_id
      FROM md_field_type_migrations WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3
      ORDER BY created_at DESC,id DESC LIMIT 50`,[tenantId,objectApi,fieldApi]);
    return rows.map(row=>({
      id:row.id,fromDataType:row.from_data_type,toDataType:row.to_data_type,status:row.status,
      recordsMigrated:row.records_migrated,createdAt:row.created_at,rolledBackAt:row.rolled_back_at,
      actorUserId:row.actor_user_id
    }));
  }
  async rollbackFieldTypeMigration(tenantId:string,objectApi:string,fieldApi:string,migrationId:string){
    await this.db.transaction(async client=>{
      await rollbackFieldTypeMigration(client,tenantId,objectApi,fieldApi,migrationId,
        this.migrationRuntime);
      await client.query(`DELETE FROM md_field_formulas
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,[tenantId,objectApi,fieldApi]);
      const formula=await client.query<{expression:string|null;return_type:string|null}>(
        `SELECT formula_expression AS expression,formula_return_type AS return_type
          FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
            AND data_type='formula'`,[tenantId,objectApi,fieldApi]);
      if(formula.rows[0]?.expression&&formula.rows[0].return_type)
        await client.query(`INSERT INTO md_field_formulas
          (tenant_id,object_api,field_api,expression,return_type) VALUES($1,$2,$3,$4,$5)`,
        [tenantId,objectApi,fieldApi,formula.rows[0].expression,formula.rows[0].return_type]);
    });
    return this.get(tenantId,objectApi);
  }
  private async purgeExpiredDeletedFields(client:PoolClient,tenantId:string){
    const expired=await client.query<{object_api:string;api_name:string;id:string}>(`
      SELECT object_api,api_name,id FROM md_field_definitions
      WHERE tenant_id=$1 AND deleted_at<=now()-interval '15 days'
      ORDER BY object_api,api_name FOR UPDATE
    `,[tenantId]);
    for(const field of expired.rows){
      await client.query(`DELETE FROM md_record_history
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
      [tenantId,field.object_api,field.api_name]);
      await client.query(`DELETE FROM md_record_values
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
      [tenantId,field.object_api,field.api_name]);
      await client.query(`DELETE FROM md_object_page_layout_fields
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
      [tenantId,field.object_api,field.api_name]);
      await client.query(`DELETE FROM md_object_record_type_values
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
      [tenantId,field.object_api,field.api_name]);
      await client.query(`DELETE FROM md_page_component_properties
        WHERE tenant_id=$1 AND field_id=$2`,
      [tenantId,field.id]);
      await client.query(`DELETE FROM md_field_definitions
        WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at<=now()-interval '15 days'`,
      [tenantId,field.object_api,field.api_name]);
    }
    return expired.rows.length;
  }
  async purgeExpiredFields(){
    const {rows:tenants}=await this.db.query<{tenant_id:string}>(`
      SELECT DISTINCT tenant_id FROM md_field_definitions
      WHERE deleted_at<=now()-interval '15 days'
    `);
    let purged=0;
    for(const {tenant_id:tenantId} of tenants){
      purged+=await this.db.transaction(client=>this.purgeExpiredDeletedFields(client,tenantId));
    }
    return purged;
  }
  async listDeletedFields(tenantId:string,objectApi:string){
    await this.get(tenantId,objectApi);
    return this.db.transaction(async client=>{
      await this.purgeExpiredDeletedFields(client,tenantId);
      const {rows}=await client.query<{api_name:string;label:string|null;data_type:string;deleted_at:Date;expires_at:Date}>(`
        SELECT api_name,label,data_type,deleted_at,deleted_at+interval '15 days' AS expires_at
        FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2
          AND deleted_at>now()-interval '15 days'
        ORDER BY deleted_at DESC,api_name
      `,[tenantId,objectApi]);
      return {fields:rows.map(field=>({
        apiName:field.api_name,label:field.label??field.api_name,dataType:field.data_type,
        deletedAt:field.deleted_at,expiresAt:field.expires_at
      }))};
    });
  }
  async restoreField(tenantId:string,objectApi:string,fieldApi:string){
    await this.db.transaction(async client=>{
      await this.purgeExpiredDeletedFields(client,tenantId);
      const restored=await client.query(`UPDATE md_field_definitions SET deleted_at=NULL
        WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
          AND deleted_at>now()-interval '15 days' RETURNING id`,
      [tenantId,objectApi,fieldApi]);
      if(!restored.rowCount)throw new Error('Field not found or recovery period expired');
    });
    return this.get(tenantId,objectApi);
  }
  async deleteField(tenantId:string,objectApi:string,fieldApi:string){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldApi))throw new Error('Invalid field API name');
    await this.db.transaction(async client=>{
      await this.purgeExpiredDeletedFields(client,tenantId);
      const {rows}=await client.query<{id:string}>(`
        SELECT id FROM md_field_definitions
        WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL FOR UPDATE
      `,[tenantId,objectApi,fieldApi]);
      if(!rows[0])throw new Error('Field not found');
      const controllerUse=await client.query(`
        SELECT 1 FROM md_field_dependencies WHERE tenant_id=$1 AND object_api=$2
          AND controller_field_api=$3 LIMIT 1
      `,[tenantId,objectApi,fieldApi]);
      if(controllerUse.rowCount)throw new Error('Field is used as a controlling field');
      const formulaUse=await client.query(`
        SELECT 1 FROM md_field_definitions WHERE tenant_id=$1 AND deleted_at IS NULL
          AND formula_expression LIKE '%'||'@'||$2||'.'||$3||'%' LIMIT 1
      `,[tenantId,objectApi,fieldApi]);
      if(formulaUse.rowCount)throw new Error('Field is referenced by an active formula');
      const validationRefs=await client.query<{expression:string;error_field_api:string|null}>(`
        SELECT expression,error_field_api FROM md_validation_rules WHERE tenant_id=$1 AND object_api=$2
      `,[tenantId,objectApi]);
      if(validationRefs.rows.some(rule=>rule.error_field_api===fieldApi||
        flowFormulaReferences(rule.expression).some(ref=>
          ref===fieldApi||ref===objectApi+'.'+fieldApi||ref==='$Record.'+fieldApi||ref==='$Record__Prior.'+fieldApi)))
        throw new Error('Field is referenced by a validation rule');
      const defaultRefs=await client.query<{field_api:string;expression:string}>(`
        SELECT field_api,expression FROM md_field_default_formulas WHERE tenant_id=$1 AND object_api=$2
      `,[tenantId,objectApi]);
      if(defaultRefs.rows.some(item=>flowFormulaReferences(item.expression).some(ref=>
        ref===fieldApi||ref===objectApi+'.'+fieldApi||ref==='$Record.'+fieldApi)))
        throw new Error('Field is referenced by a formula default');
      const matchingRefs=await client.query(
        'SELECT 1 FROM md_matching_rule_fields WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 LIMIT 1',
        [tenantId,objectApi,fieldApi]);
      if(matchingRefs.rowCount)throw new Error('Field is referenced by a matching rule');
      await client.query(`UPDATE md_field_definitions SET deleted_at=now()
        WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
        [tenantId,objectApi,fieldApi]);
    });
    return this.get(tenantId,objectApi);
  }
  /** Relational lookup dependencies. No inferred or hardcoded app references. */
  async dependencies(tenantId:string,apiName:string) {
    await this.get(tenantId,apiName);
    const {rows}=await this.db.query<{object_api:string;related_object:string}>(
      'SELECT object_api,related_object FROM md_field_definitions WHERE tenant_id=$1 AND deleted_at IS NULL AND (object_api=$2 OR related_object=$2) AND related_object IS NOT NULL ORDER BY object_api,related_object',
      [tenantId,apiName]);
    return {dependencies:[...new Set(rows.map(row=>row.object_api===apiName?row.related_object:row.object_api))].filter((name):name is string=>Boolean(name)).sort()};
  }
  async fieldDependencies(tenantId:string,apiName:string) {
    const object=await this.get(tenantId,apiName);
    const {rows}=await this.db.query<{api_name:string;related_object:string|null}>(
      'SELECT api_name,related_object FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL ORDER BY api_name',
      [tenantId,apiName]);
    return {fields:object.fields.map(field=>({
      fieldApiName:field.apiName,
      dependencies:rows.filter(row=>row.api_name===field.apiName&&row.related_object!==null).map(row=>row.related_object as string)
    }))};
  }
  async get(tenantId:string,apiName:string) {
    const objects=await this.list(tenantId);
    const object=objects.find(item=>item.apiName===apiName);
    if(!object)throw new Error('Object not found');
    return object;
  }
  async list(tenantId:string) {
    const {rows:objects}=await this.db.query<SqlObject>(
      'SELECT id,api_name,label,is_system FROM md_object_definitions WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY api_name',[tenantId]);
    const {rows:fields}=await this.db.query<SqlField>(
      `SELECT f.id,f.object_api,f.api_name,f.label,f.data_type,f.related_object,f.relationship_type,f.required,f.max_length,
        f.precision,f.scale,f.is_unique,f.external_id,f.case_sensitive,f.default_value,f.help_text,f.description,
        f.formula_expression,f.formula_return_type,f.auto_number_format,
        f.rollup_child_object,f.rollup_relationship_field,f.rollup_operation,f.rollup_source_field,f.rollup_filter_logic,
        f.picklist_restricted,f.track_history,
        d.controller_field_api AS controller_field_api_name,g.value_set_api AS global_value_set_api,
        f.relationship_name,f.child_relationship_name,
        f.delete_behavior,f.allow_reparenting
       FROM md_field_definitions f LEFT JOIN md_field_dependencies d
        ON d.tenant_id=f.tenant_id AND d.object_api=f.object_api AND d.field_api=f.api_name
       LEFT JOIN md_field_global_value_sets g
        ON g.tenant_id=f.tenant_id AND g.object_api=f.object_api AND g.field_api=f.api_name
       WHERE f.tenant_id=$1 AND f.deleted_at IS NULL ORDER BY f.object_api,f.api_name`,[tenantId]);
    const byObject=new Map<string,SqlField[]>();
    for(const field of fields) {
      const list=byObject.get(field.object_api)??[];
      list.push(field);byObject.set(field.object_api,list);
    }
    const {rows:rollupFilterRows}=fields.some(field=>field.data_type==='rollup')
      ?await this.db.query<{object_api:string;rollup_field_api:string;child_object:string;filter_field_api:string;
        operator:string;value_text:string;sort_order:number}>(`
        SELECT object_api,rollup_field_api,child_object,filter_field_api,operator,value_text,sort_order
        FROM md_field_rollup_filters WHERE tenant_id=$1 ORDER BY object_api,rollup_field_api,sort_order`,[tenantId])
      :{rows:[]};
    const rollupFilters=new Map<string,Array<{fieldApiName:string;operator:string;value:string}>>();
    for(const filter of rollupFilterRows){
      const key=JSON.stringify([filter.object_api,filter.rollup_field_api]);
      const items=rollupFilters.get(key)??[];
      items.push({fieldApiName:filter.filter_field_api,operator:filter.operator,value:filter.value_text});
      rollupFilters.set(key,items);
    }
    const typeLabel:Record<string,string>={
      text:'Text',number:'Number',boolean:'Checkbox',date:'Date',datetime:'Date/Time',time:'Time',
      reference:'Lookup',email:'Email',phone:'Phone',url:'URL',image:'Image',file:'File',picklist:'Picklist',
      multipicklist:'Multi-Select Picklist',textarea:'Text Area',longtext:'Long Text Area',
      richtext:'Rich Text Area',encryptedtext:'Text (Encrypted)',currency:'Currency',percent:'Percent',formula:'Formula',
      geolocation:'Geolocation',address:'Address',rollup:'Roll-Up Summary',autonumber:'AutoNumber'
    };
    const layouts=await this.loadLayoutMetadata(tenantId);
    const {rows:picklistOptions}=fields.some(field=>['picklist','multipicklist'].includes(field.data_type))
      ?await this.db.query<{object_api:string;field_api:string;value:string}>(`
        SELECT p.object_api,p.field_api,p.value FROM md_field_picklist_values p
        WHERE p.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM md_field_global_value_sets g
          WHERE g.tenant_id=p.tenant_id AND g.object_api=p.object_api AND g.field_api=p.field_api)
        UNION
        SELECT g.object_api,g.field_api,v.value FROM md_field_global_value_sets g
        JOIN md_global_value_sets s ON s.tenant_id=g.tenant_id AND s.api_name=g.value_set_api
        JOIN md_global_value_set_values v ON v.tenant_id=s.tenant_id AND v.value_set_id=s.id
        WHERE g.tenant_id=$1 AND v.active
        ORDER BY object_api,field_api,value`,[tenantId])
      :{rows:[]};
    const picklistKey=(objectApi:string,fieldApi:string)=>JSON.stringify([objectApi,fieldApi]);
    const optionsByField=new Map<string,string[]>();
    for(const option of picklistOptions){
      const key=picklistKey(option.object_api,option.field_api);
      const values=optionsByField.get(key)??[];
      values.push(option.value);
      optionsByField.set(key,values);
    }
    const formulas=new Map(fields.filter(field=>field.formula_expression!==null).map(field=>[
      JSON.stringify([field.object_api,field.api_name]),{
        expression:field.formula_expression!,return_type:field.formula_return_type??'Text'
      }
    ]));
    const {rows:dependencyValues}=fields.some(field=>field.controller_field_api_name)
      ?await this.db.query<{object_api:string;field_api:string;controller_value:string;picklist_value:string}>(
        `SELECT object_api,field_api,controller_value,picklist_value FROM md_field_dependency_values
         WHERE tenant_id=$1 ORDER BY object_api,field_api,controller_value,picklist_value`,[tenantId])
      :{rows:[]};
    const valuesByDependentField=new Map<string,Record<string,string[]>>();
    for(const row of dependencyValues){
      const key=picklistKey(row.object_api,row.field_api);
      const settings=valuesByDependentField.get(key)??{};
      (settings[row.controller_value]??=[]).push(row.picklist_value);
      valuesByDependentField.set(key,settings);
    }
    const [types,values]=await Promise.all([
      this.db.query<{object_api:string;record_type_id:string;label:string;developer_name:string;description:string;active:boolean;is_default:boolean;business_process_api_name:string|null}>(
        'SELECT object_api,record_type_id,label,developer_name,description,active,is_default,business_process_api_name FROM md_object_record_types WHERE tenant_id=$1 ORDER BY object_api,sort_order',[tenantId]),
      this.db.query<{object_api:string;record_type_id:string;field_api:string;field_value:string}>(
        'SELECT object_api,record_type_id,field_api,field_value FROM md_object_record_type_values WHERE tenant_id=$1 ORDER BY object_api,record_type_id,field_api,sort_order',[tenantId])
    ]);
    const typeByObject=new Map<string,Array<{id:string;label:string;developerName:string;description:string;active:boolean;isDefault:boolean;businessProcessApiName?:string;picklistValues:Record<string,string[]>}>>();
    for(const row of types.rows){
      const items=typeByObject.get(row.object_api)??[];
      items.push({id:row.record_type_id,label:row.label,developerName:row.developer_name,
        description:row.description,active:row.active,isDefault:row.is_default,
        ...(row.business_process_api_name?{businessProcessApiName:row.business_process_api_name}:{}),picklistValues:{}});
      typeByObject.set(row.object_api,items);
    }
    for(const row of values.rows){
      const recordType=typeByObject.get(row.object_api)?.find(item=>item.id===row.record_type_id);
      if(recordType){
        const current=recordType.picklistValues[row.field_api]??[];
        current.push(row.field_value);recordType.picklistValues[row.field_api]=current;
      }
    }
    return objects.map(obj=>({
      id:obj.id,apiName:obj.api_name,label:obj.label,pluralLabel:obj.label,
      kind:obj.is_system?'Standard Object' as const:'Custom Object' as const,
      description:'',
      ...(layouts.get(obj.api_name)??{revision:0,pageLayouts:[],pageLayoutAssignments:[]}),
      recordTypes:typeByObject.get(obj.api_name)??[],
      fields:(byObject.get(obj.api_name)??[]).map(f=>({
        id:f.id,apiName:f.api_name,label:f.label??f.api_name,
        dataType:f.data_type==='formula'
          ?`Formula(${formulas.get(picklistKey(f.object_api,f.api_name))?.return_type??f.formula_return_type??'Text'})`
          :f.data_type==='text'&&f.max_length?`Text(${f.max_length})`:
          ['number','currency','percent'].includes(f.data_type)&&f.precision!==null
            ?`${typeLabel[f.data_type]}(${f.precision}, ${f.scale??0})`
            :(typeLabel[f.data_type]??f.data_type),
        required:f.required,unique:f.is_unique===true,
        externalId:f.external_id===true,
        caseSensitive:f.case_sensitive===true,trackHistory:f.track_history===true,
        ...(f.description?{description:f.description}:{}),
        ...(f.help_text?{helpText:f.help_text}:{}),
        ...(f.default_value!==null&&f.default_value!==undefined?{defaultValue:decodeFieldDefault(f.data_type,f.default_value)}:{}),
        ...(formulas.has(picklistKey(f.object_api,f.api_name))||f.formula_expression!==null
          ?{formula:{
            expression:formulas.get(picklistKey(f.object_api,f.api_name))?.expression??f.formula_expression!,
            returnType:formulas.get(picklistKey(f.object_api,f.api_name))?.return_type??f.formula_return_type??'Text'
          }}:{}),
        ...(f.data_type==='rollup'?{rollup:{
          childObject:f.rollup_child_object,relationshipField:f.rollup_relationship_field,
          operation:f.rollup_operation,sourceField:f.rollup_source_field,
          filterLogic:f.rollup_filter_logic??'All',
          filters:rollupFilters.get(picklistKey(f.object_api,f.api_name))??[]
        }}:{}),
        ...(f.auto_number_format?{autoNumberFormat:f.auto_number_format}:{}),
        ...(['picklist','multipicklist'].includes(f.data_type)?{picklistValues:optionsByField.get(picklistKey(f.object_api,f.api_name))??[],picklistRestricted:f.picklist_restricted!==false}:{}),
        ...(f.global_value_set_api?{globalValueSetApiName:f.global_value_set_api}:{}),
        ...(f.controller_field_api_name?{
          controllerFieldApiName:f.controller_field_api_name,
          valueSettings:valuesByDependentField.get(picklistKey(f.object_api,f.api_name))??{}
        }:{}),
        ...(f.related_object?{relationship:{
          type:(f.relationship_type??'Lookup') as 'Lookup'|'Master-Detail'|'Hierarchical',targetObject:f.related_object,
          relationshipName:f.relationship_name??f.api_name,childRelationshipName:f.child_relationship_name??f.object_api,
          ...(f.delete_behavior?{deleteBehavior:f.delete_behavior as 'Clear'|'Restrict'}:{}),
          allowReparenting:f.allow_reparenting===true
        }}:{})
      }))
    }));
  }

  /** Object layouts are relational SQL metadata, not a client-only object property. */
  private async loadLayoutMetadata(tenantId:string) {
    const names=['md_object_layout_versions','md_object_page_layouts','md_object_page_layout_sections',
      'md_object_page_layout_fields','md_object_page_layout_actions','md_object_page_layout_related_lists',
      'md_object_page_layout_links','md_object_page_layout_assignments'];
    // Each table exposes a subset of these named SQL columns; the corresponding
    // reader below only accesses columns from that table.
    type LayoutSqlRow={
      object_api:string;revision:number;sort_order:number;
      layout_id:string;label:string;section_id:string;columns:number;
      field_api:string;action_name:string;list_name:string;settings:unknown;
      link_id:string;url:string;open_in_new_window:boolean;visible_when_field:string|null;visible_when_value:string|null;
      profile_id:string;record_type_id:string;
    };
    const [versions,layouts,sections,fields,actions,related,links,assignments]=await Promise.all(
      names.map(name=>this.db.query<LayoutSqlRow>(`SELECT * FROM ${name} WHERE tenant_id=$1`,[tenantId])));
    type Layout={id:string;label:string;sections:{id:string;label:string;columns:1|2;fieldApiNames:string[]}[];
      relatedLists:string[];relatedListSettings:Record<string,RelatedListSettings>;actions:string[];customLinks:{id:string;label:string;url:string;openInNewWindow:boolean;visibleWhenField?:string;visibleWhenValue?:string}[]};
    const byObject=new Map<string,{revision:number;pageLayouts:Layout[];pageLayoutAssignments:{profileId:string;recordTypeId:string;pageLayoutId:string}[]}>();
    const get=(name:string)=>{let value=byObject.get(name);if(!value){
      value={revision:0,pageLayouts:[],pageLayoutAssignments:[]};byObject.set(name,value);
    }return value;};
    for(const row of versions.rows)get(row.object_api).revision=Number(row.revision);
    const indexed=new Map<string,Layout>();
    const sectionIndex=new Map<string,Layout['sections'][number]>();
    const key=(...parts:string[])=>JSON.stringify(parts);
    for(const row of [...layouts.rows].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order))){
      const layout:Layout={id:row.layout_id,label:row.label,sections:[],relatedLists:[],relatedListSettings:{},actions:[],customLinks:[]};
      get(row.object_api).pageLayouts.push(layout);
      indexed.set(key(row.object_api,row.layout_id),layout);
    }
    for(const row of [...sections.rows].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order))){
      const layout=indexed.get(key(row.object_api,row.layout_id));if(!layout)continue;
      const section={id:row.section_id,label:row.label,columns:Number(row.columns) as 1|2,fieldApiNames:[] as string[]};
      layout.sections.push(section);
      sectionIndex.set(key(row.object_api,row.layout_id,row.section_id),section);
    }
    for(const row of [...fields.rows].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)))
      sectionIndex.get(key(row.object_api,row.layout_id,row.section_id))?.fieldApiNames.push(row.field_api);
    for(const row of [...actions.rows].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)))
      indexed.get(key(row.object_api,row.layout_id))?.actions.push(row.action_name);
    for(const row of [...related.rows].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order))){
      const layout=indexed.get(key(row.object_api,row.layout_id));
      if(!layout)continue;
      layout.relatedLists.push(row.list_name);
      if(row.settings&&typeof row.settings==='object'&&!Array.isArray(row.settings)
        &&Object.keys(row.settings).length)layout.relatedListSettings[row.list_name]=row.settings as RelatedListSettings;
    }
    for(const row of [...links.rows].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)))
      indexed.get(key(row.object_api,row.layout_id))?.customLinks.push({
        id:row.link_id,label:row.label,url:row.url,openInNewWindow:row.open_in_new_window,
        ...(row.visible_when_field?{visibleWhenField:row.visible_when_field,visibleWhenValue:row.visible_when_value??''}:{})
      });
    for(const row of assignments.rows)get(row.object_api).pageLayoutAssignments.push({
      profileId:row.profile_id,recordTypeId:row.record_type_id,pageLayoutId:row.layout_id
    });
    return byObject;
  }

  /** Atomic layout replacement with optimistic concurrency and strict referential validation. */
  async replaceLayouts(tenantId:string,objectApi:string,payload:unknown,expectedRevision:number,
    actorUserId?:string,persistSupplemental?:(client:PoolClient)=>Promise<void>){
    if(!payload||typeof payload!=='object'||Array.isArray(payload)
      ||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
      throw new Error('Invalid page layout request');
    const input=payload as Record<string,unknown>;
    if(!Array.isArray(input.pageLayouts)||!Array.isArray(input.pageLayoutAssignments)
      ||input.pageLayouts.length===0||input.pageLayouts.length>100||input.pageLayoutAssignments.length>1000)
      throw new Error('Invalid page layout request');
    const string=(v:unknown,max=128):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
    const list=(v:unknown,max=200):v is string[]=>Array.isArray(v)&&v.length<=max
      &&v.every(item=>string(item))&&new Set(v).size===v.length;
    const {rows:definedFields}=await this.db.query<{api_name:string}>(
      'SELECT api_name FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL',[tenantId,objectApi]);
    const fieldNames=new Set(definedFields.map(row=>row.api_name));
    type SectionInput={id:string;label:string;columns:1|2;fieldApiNames:string[]};
    type LinkInput={id:string;label:string;url:string;openInNewWindow:boolean;visibleWhenField?:string;visibleWhenValue?:string};
    type LayoutInput={id:string;label:string;sections:SectionInput[];actions:string[];relatedLists:string[];relatedListSettings:Record<string,RelatedListSettings>;customLinks:LinkInput[]};
    type AssignmentInput={profileId:string;recordTypeId:string;pageLayoutId:string};
    const normalized:LayoutInput[]=[];
    const layoutIds=new Set<string>();
    for(const raw of input.pageLayouts){
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid page layout');
      const layout=raw as Record<string,unknown>;
      if(!string(layout.id)||!string(layout.label,200)||layoutIds.has(layout.id)
        ||!Array.isArray(layout.sections)||layout.sections.length>100
        ||!list(layout.actions)||!list(layout.relatedLists))
        throw new Error('Invalid page layout');
      layoutIds.add(layout.id);
      const sections:SectionInput[]=[];const sectionIds=new Set<string>();const placed=new Set<string>();
      for(const item of layout.sections){
        if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid page layout section');
        const section=item as Record<string,unknown>;
        if(!string(section.id)||sectionIds.has(section.id)||!string(section.label,200)
          ||(section.columns!==1&&section.columns!==2)||!list(section.fieldApiNames))
          throw new Error('Invalid page layout section');
        sectionIds.add(section.id);
        for(const field of section.fieldApiNames as string[]){
          if(!fieldNames.has(field)||placed.has(field))throw new Error('Invalid page layout field: '+field);
          placed.add(field);
        }
        sections.push({id:section.id,label:section.label,columns:section.columns,fieldApiNames:section.fieldApiNames as string[]});
      }
      const linkIds=new Set<string>();const customLinks:LinkInput[]=[];
      const rawLinks=layout.customLinks??[];
      if(!Array.isArray(rawLinks)||rawLinks.length>100)throw new Error('Invalid page layout links');
      for(const item of rawLinks){
        if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid page layout link');
        const link=item as Record<string,unknown>;
        if(!string(link.id)||linkIds.has(link.id)||!string(link.label,200)||!string(link.url,2048)
          ||(!link.url.startsWith('https://')&&!/^\/(?!\/)/.test(link.url))
          ||typeof link.openInNewWindow!=='boolean')throw new Error('Invalid page layout link');
        linkIds.add(link.id);
        if(link.visibleWhenField!==undefined
          &&(typeof link.visibleWhenField!=='string'
            ||!fieldNames.has(link.visibleWhenField)
            ||typeof link.visibleWhenValue!=='string'||link.visibleWhenValue.length>256))
          throw new Error('Invalid custom link visibility condition');
        if(link.visibleWhenValue!==undefined&&link.visibleWhenField===undefined)
          throw new Error('Custom link visibility requires a field');
        customLinks.push({id:link.id,label:link.label,url:link.url,openInNewWindow:link.openInNewWindow,
          ...(link.visibleWhenField?{visibleWhenField:link.visibleWhenField,
            visibleWhenValue:typeof link.visibleWhenValue==='string'?link.visibleWhenValue:''}:{})});
      }
      const settings=validateRelatedListSettings(layout.relatedLists as string[],layout.relatedListSettings);
      normalized.push({id:layout.id,label:layout.label,sections,
        actions:layout.actions as string[],relatedLists:layout.relatedLists as string[],
        relatedListSettings:settings,customLinks});
    }

    type RecordTypeInput={id:string;label:string;developerName:string;description:string;
      active:boolean;isDefault:boolean;businessProcessApiName?:string;picklistValues:Record<string,string[]>};
    let recordTypes:RecordTypeInput[]|undefined;
    if(input.recordTypes!==undefined){
      if(!Array.isArray(input.recordTypes)||input.recordTypes.length===0||input.recordTypes.length>100)
        throw new Error('Invalid record types');
      recordTypes=[];const ids=new Set<string>();let defaults=0;
      for(const raw of input.recordTypes){
        if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid record type');
        const t=raw as Record<string,unknown>;
        if(t.businessProcessApiName!==undefined&&(!string(t.businessProcessApiName)
          ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(t.businessProcessApiName)))
          throw new Error('Invalid business process assignment');
        if(!string(t.id)||ids.has(t.id)||!string(t.label,200)
          ||!string(t.developerName)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(t.developerName)
          ||typeof t.active!=='boolean'||typeof t.isDefault!=='boolean'
          ||(t.description!==undefined&&typeof t.description!=='string'))
          throw new Error('Invalid record type');
        ids.add(t.id);if(t.isDefault)defaults++;
        const options:Record<string,string[]>={};
        const rawOptions=t.picklistValues??{};
        if(!rawOptions||typeof rawOptions!=='object'||Array.isArray(rawOptions))throw new Error('Invalid record type values');
        for(const [field,values] of Object.entries(rawOptions)){
          if(!fieldNames.has(field)||!list(values,200))throw new Error('Invalid record type field values');
          options[field]=values;
        }
        recordTypes.push({id:t.id,label:t.label,developerName:t.developerName,
          description:typeof t.description==='string'?t.description:'',active:t.active,
          isDefault:t.isDefault,
          ...(typeof t.businessProcessApiName==='string'?{businessProcessApiName:t.businessProcessApiName}:{}),
          picklistValues:options});
      }
      if(defaults!==1||!recordTypes.some(t=>t.active&&t.isDefault))throw new Error('Invalid default record type');
    }

    const assigned:AssignmentInput[]=[];const assignmentKeys=new Set<string>();
    for(const raw of input.pageLayoutAssignments){
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid layout assignment');
      const a=raw as Record<string,unknown>;
      if(!string(a.profileId)||!string(a.recordTypeId)||!string(a.pageLayoutId)
        ||!layoutIds.has(a.pageLayoutId))throw new Error('Invalid layout assignment');
      const key=JSON.stringify([a.profileId,a.recordTypeId]);
      if(assignmentKeys.has(key))throw new Error('Invalid duplicate layout assignment');
      assignmentKeys.add(key);
      assigned.push({profileId:a.profileId,recordTypeId:a.recordTypeId,pageLayoutId:a.pageLayoutId});
    }
    await this.db.transaction(async client=>{
      const found=await client.query(
        'SELECT label FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 FOR UPDATE',[tenantId,objectApi]);
      if(!found.rows.length)throw new Error('Object not found');
      await client.query(`INSERT INTO md_object_layout_versions(tenant_id,object_api)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`,[tenantId,objectApi]);
      const version=await client.query<{revision:number}>(
        'SELECT revision FROM md_object_layout_versions WHERE tenant_id=$1 AND object_api=$2 FOR UPDATE',[tenantId,objectApi]);
      if(version.rows[0].revision!==expectedRevision)throw new Error('Page layout revision conflict');
      if(typeof input.label==='string'){
        if(!input.label.trim()||input.label.length>200)throw new Error('Invalid object label');
        await client.query('UPDATE md_object_definitions SET label=$3 WHERE tenant_id=$1 AND api_name=$2',
          [tenantId,objectApi,input.label.trim()]);
      }
      await client.query('DELETE FROM md_object_page_layouts WHERE tenant_id=$1 AND object_api=$2',[tenantId,objectApi]);
      for(const [i,layout] of normalized.entries()){
        await client.query(`INSERT INTO md_object_page_layouts
          (tenant_id,object_api,layout_id,label,sort_order) VALUES ($1,$2,$3,$4,$5)`,
          [tenantId,objectApi,layout.id,layout.label,i]);
        for(const [j,section] of layout.sections.entries()){
          await client.query(`INSERT INTO md_object_page_layout_sections
            (tenant_id,object_api,layout_id,section_id,label,columns,sort_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [tenantId,objectApi,layout.id,section.id,section.label,section.columns,j]);
          for(const [k,field] of section.fieldApiNames.entries())
            await client.query(`INSERT INTO md_object_page_layout_fields
              (tenant_id,object_api,layout_id,section_id,field_api,sort_order)
              VALUES ($1,$2,$3,$4,$5,$6)`,[tenantId,objectApi,layout.id,section.id,field,k]);
        }
        for(const [j,action] of layout.actions.entries())await client.query(`INSERT INTO md_object_page_layout_actions
          (tenant_id,object_api,layout_id,action_name,sort_order) VALUES ($1,$2,$3,$4,$5)`,
          [tenantId,objectApi,layout.id,action,j]);
        for(const [j,name] of layout.relatedLists.entries())await client.query(`INSERT INTO md_object_page_layout_related_lists
          (tenant_id,object_api,layout_id,list_name,sort_order,settings) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [tenantId,objectApi,layout.id,name,j,JSON.stringify(layout.relatedListSettings[name]??{})]);
        for(const [j,link] of layout.customLinks.entries())await client.query(`INSERT INTO md_object_page_layout_links
          (tenant_id,object_api,layout_id,link_id,label,url,open_in_new_window,sort_order,
            visible_when_field,visible_when_value)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tenantId,objectApi,layout.id,link.id,link.label,link.url,link.openInNewWindow,j,
            link.visibleWhenField??null,link.visibleWhenField?(link.visibleWhenValue??''):null]);
      }
      for(const assignment of assigned)await client.query(`INSERT INTO md_object_page_layout_assignments
        (tenant_id,object_api,profile_id,record_type_id,layout_id) VALUES ($1,$2,$3,$4,$5)`,
        [tenantId,objectApi,assignment.profileId,assignment.recordTypeId,assignment.pageLayoutId]);

      if(recordTypes){
        for(const t of recordTypes){
          if(!t.businessProcessApiName)continue;
          // No automatic mutation of customer-defined picklists when a process changes.
          const process=await client.query<{status_field:string}>(`
            SELECT status_field FROM md_object_business_processes
            WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND active=true`,
            [tenantId,objectApi,t.businessProcessApiName]);
          if(!process.rows[0])throw new Error('Business process unavailable or inactive');
          const values=await client.query<{value_text:string}>(`
            SELECT value_text FROM md_object_business_process_values
            WHERE tenant_id=$1 AND object_api=$2 AND process_api=$3 ORDER BY sort_order`,
            [tenantId,objectApi,t.businessProcessApiName]);
          const selected=t.picklistValues[process.rows[0].status_field]??[];
          const configured=values.rows.map(value=>value.value_text);
          if(selected.length!==configured.length||selected.some((value,i)=>value!==configured[i]))
            throw new Error('Apply the business process status values before saving');
        }
        const used=await client.query<{record_type_id:string|null}>(`SELECT DISTINCT record_type_id
          FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND record_type_id IS NOT NULL`,
          [tenantId,objectApi]);
        for(const row of used.rows)
          if(row.record_type_id&&!recordTypes.some(t=>t.id===row.record_type_id))
            throw new Error('Record type has stored records; removal requires reviewed migration');
        await client.query('DELETE FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2',
          [tenantId,objectApi]);
        for(const [index,t] of recordTypes.entries()){
          await client.query(`INSERT INTO md_object_record_types
            (tenant_id,object_api,record_type_id,developer_name,label,description,active,is_default,sort_order,business_process_api_name)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [tenantId,objectApi,t.id,t.developerName,t.label,t.description,t.active,t.isDefault,index,
              t.businessProcessApiName??null]);
          for(const [field,values] of Object.entries(t.picklistValues))
            for(const [order,value] of values.entries())await client.query(`INSERT INTO md_object_record_type_values
              (tenant_id,object_api,record_type_id,field_api,field_value,sort_order)
              VALUES($1,$2,$3,$4,$5,$6)`,[tenantId,objectApi,t.id,field,value,order]);
        }
      }
      // Supplemental settings can reference record types created in this same revision.
      if(persistSupplemental)await persistSupplemental(client);
      await client.query(`UPDATE md_object_layout_versions SET revision=revision+1,updated_at=now()
        WHERE tenant_id=$1 AND object_api=$2`,[tenantId,objectApi]);
      await ObjectMetadataHistory.capture(client,tenantId,objectApi,expectedRevision+1,actorUserId,{
        apiName:objectApi,label:typeof input.label==='string'?input.label.trim():
          (found.rows[0] as {label:string}).label,
        revision:expectedRevision+1,pageLayouts:normalized,pageLayoutAssignments:assigned,
        ...(recordTypes?{recordTypes}:{}),
      });
    });
    return this.get(tenantId,objectApi);
  }
}
