import {compileActionPlan,isActionPlan,isScreenAction,parseScreenAction} from '../expression-engine/ActionFormulas.js';
import {type ComponentSettingDefinition,validateComponentSettings,isPropertyRecord} from './component-property-contract.js';
const text=(propertyKey:string,label:string,required=false):ComponentSettingDefinition=>({propertyKey,label,kind:'TEXT',required});
const choice=(propertyKey:string,label:string,values:string[]):ComponentSettingDefinition=>({propertyKey,label,kind:'SELECT',choices:values.map(key=>({key,label:key}))});
export const conditionSettings:ComponentSettingDefinition[]=[
 {...choice('logic','Match conditions',['All','Any']),defaultValue:'All'},
 {...text('expression','Condition expression (e.g. 1 AND (2 OR 3))'),maxLength:160},
 {propertyKey:'conditions',label:'Conditions',kind:'COLLECTION',minItems:1,maxItems:20,fields:[
  {...choice('source','Source',['Device','Record Field','Record Type','User Profile','Record Permission']),required:true},
 text('fieldApiName','Record field'),{...choice('operator','Comparison',['Equals','Not Equals','Contains',
  'Greater Than','Greater Than or Equal','Less Than','Less Than or Equal','Is Blank','Is Not Blank',
  'Includes','Excludes']),required:true},text('value','Value')
 ]}
];
/** Reusable schema fragments; consumers opt in only when they implement the behaviour.
 * These are data contracts, not a second condition/action/Flow engine. */
export const pageBehaviorSchemas:Record<string,ComponentSettingDefinition>={
 fieldRules:{propertyKey:'fieldRules',label:'Field behaviour',kind:'COLLECTION',maxItems:400,fields:[
  {...text('fieldApiName','Field',true),kind:'OBJECT_FIELD'},
  {...choice('behavior','Behaviour',['Editable','Required','ReadOnly']),defaultValue:'Editable'},
  {propertyKey:'visibilityRules',label:'Show / Hide rules',kind:'GROUP',fields:conditionSettings}
 ]},
 conditionalFormatting:{propertyKey:'conditionalFormatting',label:'Conditional appearance',kind:'COLLECTION',maxItems:100,fields:[
  text('id','Rule ID',true),{...text('fieldApiName','Field',true),kind:'OBJECT_FIELD'},
  {propertyKey:'when',label:'When',kind:'GROUP',required:true,fields:conditionSettings},
  {propertyKey:'appearance',label:'Appearance',kind:'GROUP',required:true,fields:[
   {...text('color','Text colour'),kind:'COLOR'},{...text('backgroundColor','Background colour'),kind:'COLOR'},text('icon','Icon'),text('accessibleLabel','Accessible label')
  ]}
 ]},
 validationRules:{propertyKey:'validationRules',label:'Action validation rules',kind:'COLLECTION',maxItems:100,fields:[
  text('event','Event',true),text('message','Error message',true),
  {propertyKey:'when',label:'Reject when',kind:'GROUP',required:true,fields:conditionSettings}
 ]},
 actionVisibility:{propertyKey:'actionVisibility',label:'Action rules',kind:'COLLECTION',maxItems:100,fields:[
  text('actionId','Action',true),{...choice('unavailable','When unavailable',['Hide','Disable']),defaultValue:'Disable'},
  {propertyKey:'when',label:'Show / Enable when',kind:'GROUP',required:true,fields:conditionSettings}
 ]},
 tabVisibility:{propertyKey:'tabVisibility',label:'Tab rules',kind:'COLLECTION',maxItems:100,fields:[
  text('tabId','Tab ID',true),{propertyKey:'when',label:'Show when',kind:'GROUP',required:true,fields:conditionSettings}
 ]},
 interactions:{propertyKey:'interactions',label:'Component interactions',kind:'COLLECTION',maxItems:100,fields:[
  text('event','Source event',true),text('targetComponentId','Target component',true),text('targetProperty','Target property',true),
  {...choice('source','Value source',['Event','PageState','Literal']),required:true},
  {...choice('valueType','Literal type',['Text','Number','Boolean','Null']),defaultValue:'Text'},
  text('sourceKey','Source key'),text('value','Literal value')
 ]}
};
export const recordFieldSettings:ComponentSettingDefinition[]=[
 {propertyKey:'requiredOnLayout',label:'Required on this layout',kind:'BOOLEAN'},
 {propertyKey:'readOnlyOnLayout',label:'Read-only on this layout',kind:'BOOLEAN'}
];
export const recordSectionSettings:ComponentSettingDefinition[]=[
 {propertyKey:'requiredFieldApiNames',label:'Required fields',kind:'STRING_LIST',maxItems:400,maxLength:128},
 {propertyKey:'readOnlyFieldApiNames',label:'Read-only fields',kind:'STRING_LIST',maxItems:400,maxLength:128}
];
/** Reserved versioned envelope prevents accidental reinterpretation of legacy/custom keys. */
export const pagePropertyContract:ComponentSettingDefinition={
 propertyKey:'pagePropertyContract',label:'Page behaviour metadata',kind:'GROUP',schemaVersion:1,fields:[
  {propertyKey:'version',label:'Contract version',kind:'NUMBER',required:true,min:1,max:1,defaultValue:1},
  ...Object.values(pageBehaviorSchemas)
 ]
};
/** The server validates the same bounded expression grammar before draft publication.
 * Numbered references must point to existing condition rows. No executable syntax.
 */
export function conditionExpressionIssues(raw:unknown):string[]{
 if(!isPropertyRecord(raw)||raw.expression===undefined)return [];
 const expression=raw.expression;
 const conditions=raw.conditions;
 if(typeof expression!=='string'||expression.length>160||!Array.isArray(conditions))
   return ['Invalid condition expression'];
 const compact=expression.replace(/\s+/g,'').toUpperCase();
 const tokens=compact.match(/\d+|AND|OR|\(|\)/g)??[];
 if(!compact||tokens.length>100||tokens.join('')!==compact)
   return ['Invalid condition expression'];
 let index=0;
 const primary=():void=>{
   const token=tokens[index++];
   if(token==='('){or();if(tokens[index++]!==')')throw Error('Invalid grouping');return;}
   if(!token||!/^\d+$/.test(token)||!Number.isSafeInteger(Number(token))
     ||Number(token)<1||Number(token)>conditions.length)
     throw Error('Invalid condition reference');
 };
 const and=():void=>{primary();while(tokens[index]==='AND'){index++;primary();}};
 const or=():void=>{and();while(tokens[index]==='OR'){index++;and();}};
 try{or();return index===tokens.length?[]:['Unexpected condition token'];}
 catch{return ['Invalid condition expression'];}
}
function nestedConditionIssues(properties:Record<string,unknown>):Array<{path:string;message:string}>{
 const envelope=properties.pagePropertyContract;
 if(!isPropertyRecord(envelope))return conditionExpressionIssues(properties.visibilityRules)
   .map(message=>({path:'visibilityRules.expression',message}));
 const output:Array<{path:string;message:string}>=[];
 for(const error of conditionExpressionIssues(properties.visibilityRules))
   output.push({path:'visibilityRules.expression',message:error});
 for(const key of ['fieldRules','actionVisibility','tabVisibility','validationRules','conditionalFormatting']){
   const entries=envelope[key];
   if(!Array.isArray(entries))continue;
   entries.forEach((entry,index)=>{
     if(!isPropertyRecord(entry))return;
     const prop=key==='fieldRules'?'visibilityRules':'when';
     for(const error of conditionExpressionIssues(entry[prop]))
       output.push({path:'pagePropertyContract.'+key+'['+index+'].'+prop+'.expression',message:error});
   });
 }
 return output;
}
export function pagePropertyIssues(type:string,properties:unknown){
 if(properties===undefined)return [];
 if(!isPropertyRecord(properties))return [{path:'properties',message:'Invalid component properties'}];
 const definitions=[pagePropertyContract,
  ...(type==='Record Field'?recordFieldSettings:type==='Field Section'?recordSectionSettings:[])];
 return [...validateComponentSettings(definitions,properties),...nestedConditionIssues(properties)];
}
export function requirePagePropertyContract(type:string,properties:unknown){
 if(isPropertyRecord(properties)&&isPropertyRecord(properties.actionFlows)){
  for(const binding of Object.values(properties.actionFlows)){
   if(!isPropertyRecord(binding)||binding.actionType!=='Formula'||typeof binding.formula!=='string')continue;
   if(isActionPlan(binding.formula))compileActionPlan(binding.formula);
   else if(isScreenAction(binding.formula))parseScreenAction(binding.formula);
  }
 }
 const issues=pagePropertyIssues(type,properties);
 if(issues.length)throw Error('Invalid Page properties: '+issues.map(x=>x.path+': '+x.message).join('; '));
}
