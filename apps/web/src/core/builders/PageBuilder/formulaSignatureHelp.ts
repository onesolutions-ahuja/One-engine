import {formulaFunctionCatalog} from '../../../../../server/src/expression-engine/FormulaFunctionRegistry.js';

/** Excel-style argument guidance for any registered function, including nested calls.
 * Quotes and commas inside nested expressions are ignored. No evaluation occurs. */
export function formulaSignatureAt(source:string,caret:number,actions=false){
 const frames:Array<{name:string;argument:number}>=[];
 let quote=false;
 for(let index=0;index<Math.max(0,Math.min(caret,source.length));index++){
  const character=source[index];
  if(character==='"'){
   if(quote&&source[index+1]==='"'){index++;continue;}
   quote=!quote;continue;
  }
  if(quote)continue;
  if(character==='('){
   const prefix=source.slice(0,index).match(/([A-Za-z][A-Za-z0-9_]*)\s*$/);
   frames.push({name:prefix?.[1].toUpperCase()??'',argument:0});
  }else if(character===')')frames.pop();
  else if(character===','&&frames.length)frames[frames.length-1].argument++;
 }
 const active=frames.at(-1);
 if(!active)return null;
 if(actions){
  const signatures:Record<string,string[]>={
   EMAIL:['NamedCredential','To','Subject','Body','Attachment'],WHATSAPP:['NamedCredential','Recipient','Message','Attachment'],
   SMS:['NamedCredential','To','Message'],PRINT:['TemplateApiName','RecordId'],
   CREATEPDF:['TemplateApiName','RecordId','AS(variable)'],WAIT:['Minutes','Seconds'],SCREEN:['PageApiName','Mode'],FLOW:['FlowApiName'],ACTIONS:['Action'],CREATERECORD:['Object','Field','Value'],
   UPDATERECORD:['Object','RecordId','Field','Value'],DELETERECORD:['Object','RecordId'],
   GETRECORD:['Object','Field','Value'],STATE:['Key','Value'],COUNTIFS:['Object','Field','Value'],
   SUMIFS:['Object','ValueField','Field','Value'],AVERAGEIFS:['Object','ValueField','Field','Value'],
   MINIFS:['Object','ValueField','Field','Value'],MAXIFS:['Object','ValueField','Field','Value'],
   VERIFYPIN:['UserId','Pin'],FOREACH:['Object','Field','Value','AS(item)','Action'],CLOSESCREEN:[],AS:['variable']
  };
  const signature=Object.prototype.hasOwnProperty.call(signatures,active.name)?signatures[active.name]:undefined;
  if(signature){
   const pairs=['CREATERECORD','UPDATERECORD','GETRECORD','COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS'].includes(active.name);
   const attachments=['EMAIL','WHATSAPP'].includes(active.name);
   const repeating=pairs||attachments||active.name==='ACTIONS';
   const minimum=active.name==='SCREEN'||active.name==='CREATERECORD'?1:active.name==='GETRECORD'||active.name==='COUNTIFS'?3:
    ['SUMIFS','AVERAGEIFS','MINIFS','MAXIFS'].includes(active.name)?2:active.name==='VERIFYPIN'?1:active.name==='FOREACH'?3:
    active.name==='CREATEPDF'?2:attachments?signature.length-1:signature.length;
   const count=repeating?Math.max(signature.length,active.argument+2):signature.length;
   const parameters=Array.from({length:count},(_,i)=>({
    name:signature[i]??(pairs?signature[signature.length-2+(i-signature.length)%2]:attachments?'Attachment'+(i-signature.length+2):'Action'),
    optional:i>=minimum
   }));
   return {name:active.name,argument:Math.min(active.argument,count-1),parameters,
    minimumArguments:minimum,maximumArguments:count};
  }
 }
 const definition=formulaFunctionCatalog.get(active.name);
 if(!definition)return null;
 const {parameters,minimumArguments,maximumArguments}=definition.signature;
 const names=parameters.map((entry,index)=>{
  const ordinal=index+1;
  const titles:Record<string,string[]>={
   COLLECTION:['name','value1'],IF:['condition','value_if_true','value_if_false'],
   IFERROR:['value','fallback'],AND:['condition1'],OR:['condition1'],
   ISBLANK:['value'],ISNULL:['value'],SUM:['number1'],
   LEFT:['text','number_of_characters'],RIGHT:['text','number_of_characters'],
   FIND:['find_text','within_text','start'],
   CONTAINS:['text','search'],
   ROUND:['number','digits'],DATE:['year','month','day'],

  };
  // SUMIFS-like groups: name, caption, criteria field, criterion, repeating.
  // A standalone @Field (optionally compared to a criterion) also expands records.
  const collectionName=index===0?'name':(['tab_label','criteria_range','criteria'][(index-1)%3]+
    (index<=3?'':Math.floor((index-1)/3)+1));
  const title=active.name==='COLLECTION'?collectionName:
    titles[active.name]?.[index]??(['AND','OR'].includes(active.name)?'condition'+ordinal:
    entry.name.replace(/^argument/, 'value'));
  return {name:title,optional:index>=minimumArguments};
 });
 return {name:active.name,argument:Math.min(active.argument,maximumArguments-1),parameters:names,
  minimumArguments,maximumArguments};
}
