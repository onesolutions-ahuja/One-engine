import {isComponentVisible,type ComponentVisibilityContext} from '../../components/Properties/componentVisibility';
import {isPropertyRecord,validateComponentSetting} from '../../components/Properties/componentSettingDefinitions';
import type {ComponentSettingDefinition,PropertyDevice} from '../../components/Properties/componentSettingDefinitions';
import type {ComponentEventDefinition,ComponentEventPayloadField} from '../../metadata/Definitions/metadata';
import {resolvePageStatePath} from './pageComponentBindings';

/**
 * Runtime adapter for the versioned Page Property Contract. It deliberately
 * delegates condition evaluation to the existing visibility engine, and never
 * grants Object, Field, Record, Action or Flow permissions.
 */
export type BehaviorContext = ComponentVisibilityContext;
type Row = Record<string,unknown>;
const namePattern=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const denied=new Set(['__proto__','prototype','constructor','pagePropertyContract',
  'actionFlows','stateBindings','filters','objectApiName','records','onAction','onChange',
  'children','sessionId','pageSessionKey','componentId','key','ref','loadAsset',
  'loadCompanySettings','onLaunchFlow','onNavigate','preview','previewOnly']);
const colorPattern=/^(?:#[a-f0-9]{3}(?:[a-f0-9]{3})?(?:[a-f0-9]{2})?|transparent)$/i;
const asRows=(value:unknown):Row[]=>Array.isArray(value)?value.filter(isPropertyRecord):[];
export function pageBehaviors(properties:Readonly<Record<string,unknown>>):Row|null{
  const raw=properties.pagePropertyContract;
  return isPropertyRecord(raw)&&raw.version===1?raw:null;
}
export function behaviorMatches(rule:unknown,context:BehaviorContext):boolean{
  if(!isPropertyRecord(rule))return false;
  return isComponentVisible({visible:true,properties:{visibilityRules:rule}},context,
    Boolean(context.fields||context.record||context.recordPermissions||context.profileId));
}
export function behaviorTabs(properties:Readonly<Record<string,unknown>>,
  tabs:readonly string[],context:BehaviorContext):string[]{
  const rules=asRows(pageBehaviors(properties)?.tabVisibility);
  return tabs.filter(tab=>{
    const matching=rules.filter(row=>row.tabId===tab);
    // All authored rules for a tab must permit display; a later rule cannot
    // override an earlier denial, matching Dynamic Action composition.
    return matching.every(rule=>behaviorMatches(rule.when,context));
  });
}
export function behaviorTabForChild(
  childTab:unknown,configuredTabs:readonly string[],visibleTabs:readonly string[]
):string|null {
  if (typeof childTab === 'string' && configuredTabs.includes(childTab)) {
    return visibleTabs.includes(childTab) ? childTab : null;
  }
  return visibleTabs[0] ?? null;
}
export type BehaviorActionState='enabled'|'disabled'|'hidden';
export function behaviorAction(properties:Readonly<Record<string,unknown>>,
  actionId:string,context:BehaviorContext):BehaviorActionState{
  const rules=asRows(pageBehaviors(properties)?.actionVisibility)
    .filter(row=>row.actionId===actionId);
  // Multiple conditions on one action are conjunctive at the row level.
  // A hidden action may never be re-enabled by a later matching row.
  let state:BehaviorActionState='enabled';
  for(const rule of rules){
    if(behaviorMatches(rule.when,context))continue;
    if(rule.unavailable==='Hide')return 'hidden';
    state='disabled';
  }
  return state;
}
/** Declarative client-side validation before an event runs. Server APIs retain their own RBAC and validation. */
export function behaviorValidation(properties:Readonly<Record<string,unknown>>,
  event:string,context:BehaviorContext):string|null{
  for(const rule of asRows(pageBehaviors(properties)?.validationRules)){
    if(rule.event!==event||!behaviorMatches(rule.when,context))continue;
    return typeof rule.message==='string'&&rule.message.trim()?rule.message:'This action is not valid.';
  }
  return null;
}
/** Resolve versioned action rules together with the retained record-layout rules.
 * A legacy condition may hide an action, but never override a versioned denial.
 * This only controls presentation; the Record API enforces actual grants.
 */
export function behaviorRecordAction(
  properties:Readonly<Record<string,unknown>>,
  actionId:string,context:BehaviorContext,
  legacyCondition?:{fieldApiName:string;equalsValue:string;operator?:string}
):BehaviorActionState{
  const state=behaviorAction(properties,actionId,context);
  if(state!=='enabled'||!legacyCondition)return state;
  const field=legacyCondition.fieldApiName;
  if(!context.record||!context.readableFieldApiNames?.has(field)
    ||!Object.prototype.hasOwnProperty.call(context.record,field))return 'hidden';
  const value=context.record[field];
  const text=value===null||value===undefined?'':String(value);
  const expected=legacyCondition.equalsValue;
  let matched=false;
  switch(legacyCondition.operator??'Equals'){
    case 'Equals':matched=text===expected;break;
    case 'NotEquals':matched=text!==expected;break;
    case 'Contains':matched=!!expected&&text.toLocaleLowerCase().includes(expected.toLocaleLowerCase());break;
    case 'IsBlank':matched=!text.trim();break;
    case 'IsNotBlank':matched=!!text.trim();break;
    default:matched=false;
  }
  return matched?'enabled':'hidden';
}
export function behaviorAppearance(properties:Readonly<Record<string,unknown>>,
  context:BehaviorContext,fieldApiName?:string):Record<string,string>{
  const output:Record<string,string>={};
  for(const rule of asRows(pageBehaviors(properties)?.conditionalFormatting)){
    if(fieldApiName!==undefined&&rule.fieldApiName!==fieldApiName)continue;
    if(!behaviorMatches(rule.when,context)||!isPropertyRecord(rule.appearance))continue;
    for(const key of ['color','backgroundColor'] as const){
      const value=rule.appearance[key];
      if(typeof value==='string'&&colorPattern.test(value))output[key]=value;
    }
  }
  return output;
}
/** Text alongside conditional colour is required for non-colour-dependent
 * interpretation. Only bounded literal labels from matched declarative rules.
 */
export function behaviorAppearanceLabel(properties:Readonly<Record<string,unknown>>,
 context:BehaviorContext,fieldApiName?:string):string{
 let result='';
 for(const rule of asRows(pageBehaviors(properties)?.conditionalFormatting)){
  if(fieldApiName!==undefined&&rule.fieldApiName!==fieldApiName)continue;
  if(!behaviorMatches(rule.when,context)||!isPropertyRecord(rule.appearance))continue;
  const label=rule.appearance.accessibleLabel;
  if(typeof label==='string'&&label.trim()&&label.length<=160)result=label.trim();
 }
 return result;
}
/** A field rule never overrides OneEngine's authorization; hidden fields are omitted. */
export function behaviorField(properties:Readonly<Record<string,unknown>>,
  fieldApiName:string,context:BehaviorContext):
  {visible:boolean;required:boolean;readOnly:boolean}|null{
  const rules=asRows(pageBehaviors(properties)?.fieldRules).filter(row=>row.fieldApiName===fieldApiName);
  if(!rules.length)return null;
  let required=false,readOnly=false;
  for(const rule of rules){
    // Conditions must be evaluated per rule, not allow a single unrelated rule
    // to suppress every matching rule for the same field.
    if(rule.visibilityRules!==undefined&&!behaviorMatches(rule.visibilityRules,context))
      continue;
    if(rule.behavior==='Required')required=true;
    else if(rule.behavior==='ReadOnly')readOnly=true;
    else if(rule.behavior!=='Editable')continue;
  }
  // A field with exclusively conditional rules stays hidden until at least one
  // condition is met; unconditional rows keep the field visible.
  const visible=rules.some(rule=>rule.visibilityRules===undefined
    ||behaviorMatches(rule.visibilityRules,context));
  return {visible,required:visible&&required&&!readOnly,readOnly:visible&&readOnly};
}
export type BehaviorInteraction={targetComponentId:string;targetProperty:string;value:string|number|boolean|null};
function payloadPathValue(payload:unknown,path:string):unknown{
 if(!path)return payload;
 const parts=path.split('.');
 if(parts.length>4||!parts.every(part=>namePattern.test(part)&&!denied.has(part)))return undefined;
 let value:unknown=payload;
 for(const part of parts){
  if(!isPropertyRecord(value)||!Object.prototype.hasOwnProperty.call(value,part))return undefined;
  value=value[part];
 }
 return value;
}
function payloadSchemaField(fields:readonly ComponentEventPayloadField[],path:string):ComponentEventPayloadField|undefined{
 const parts=path.split('.');
 if(parts.length>4||!parts.every(part=>namePattern.test(part)&&!denied.has(part)))return undefined;
 let current=fields;
 let match:ComponentEventPayloadField|undefined;
 for(const part of parts){
  match=current.find(field=>field.apiName===part);
  if(!match)return undefined;
  current=match.fields??[];
 }
 return match;
}
function payloadKindMatches(kind:ComponentEventPayloadField['kind'],value:unknown):boolean{
 if(kind==='TEXT')return typeof value==='string';
 if(kind==='NUMBER')return typeof value==='number'&&Number.isFinite(value);
 if(kind==='BOOLEAN')return typeof value==='boolean';
 return isPropertyRecord(value);
}
/** Resolve only primitive values and declared bindable target properties. */
export function behaviorInteractions(
  sourceProperties:Readonly<Record<string,unknown>>,eventName:string,payload:unknown,
  pageState:Readonly<Record<string,unknown>>,
  targets:ReadonlyArray<{id:string;propertyDefinitions?:readonly ComponentSettingDefinition[];componentVersion?:number}>,
  device?:PropertyDevice,sourceEventDefinitions?:readonly ComponentEventDefinition[]
):BehaviorInteraction[]{
  const actions=asRows(pageBehaviors(sourceProperties)?.interactions);
  const result:BehaviorInteraction[]=[];
  for(const row of actions){
    if(row.event!==eventName||typeof row.targetComponentId!=='string'
      ||typeof row.targetProperty!=='string'
      ||!namePattern.test(row.targetProperty)||denied.has(row.targetProperty))continue;
    const target=targets.find(item=>item.id===row.targetComponentId);
    if(!target)continue;
    const definition=target.propertyDefinitions?.find(item=>item.propertyKey===row.targetProperty
      &&item.isBindable===true&&(!device||!item.devices||item.devices.includes(device))
      &&(!item.sinceVersion||target.componentVersion!==undefined&&item.sinceVersion<=target.componentVersion));
    if(!definition)continue;
    let value:unknown;
    if(row.source==='Literal'){
      const literalType=row.valueType??'Text';
      if(literalType==='Text'&&typeof row.value==='string')value=row.value;
      else if(literalType==='Number'&&(typeof row.value==='number'
        ||typeof row.value==='string'&&row.value.trim()!=='')){
        value=Number(row.value);
        if(!Number.isFinite(value))continue;
      }else if(literalType==='Boolean'&&(row.value===true||row.value===false
        ||row.value==='true'||row.value==='false'))value=row.value===true||row.value==='true';
      else if(literalType==='Null')value=null;
      else continue;
    }
    else if(row.source==='PageState'){
      const key=row.sourceKey;
      if(typeof key!=='string')continue;
      value=resolvePageStatePath(pageState,key);
    } else if(row.source==='Event'){
      const key=row.sourceKey;
      if(key!==undefined&&typeof key!=='string')continue;
      const path=typeof key==='string'?key:'';
      const event=sourceEventDefinitions?.find(item=>item.apiName===eventName);
      if(sourceEventDefinitions&&!event)continue;
      if(path&&event?.payloadFields){
        const field=payloadSchemaField(event.payloadFields,path);
        if(!field)continue;
        value=payloadPathValue(payload,path);
        if(!payloadKindMatches(field.kind,value))continue;
      }else value=payloadPathValue(payload,path);
    } else continue;
    if(value!==null&&!['string','number','boolean'].includes(typeof value))continue;
    if(typeof value==='string'&&value.length>20000)continue;
    if(typeof value==='number'&&!Number.isFinite(value))continue;
    if(value!==null){
      if(definition.kind==='NUMBER'||definition.kind==='CURRENCY'){
        if(typeof value!=='number')continue;
      }else if(definition.kind==='BOOLEAN'){
        if(typeof value!=='boolean')continue;
      }else if(!['TEXT','COLOR','SELECT','IMAGE'].includes(definition.kind)
        ||typeof value!=='string')continue;
    }
    if(!validateComponentSetting(definition,value))continue;
    result.push({targetComponentId:target.id,targetProperty:row.targetProperty,
      value:value as string|number|boolean|null});
  }
  return result;
}
