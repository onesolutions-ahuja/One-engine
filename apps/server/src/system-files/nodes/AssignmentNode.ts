type FlowNode={id:number;type:string;config:Record<string,unknown>};
type FlowResource={name:string;type:string;dataType:string;isCollection?:boolean};
type FlowRecord=Record<string,unknown>;

function records(value:unknown):FlowRecord[] {
 if(!Array.isArray(value)||value.length>200)
  throw new Error('Flow record collection must contain at most 200 records');
 if(value.some(item=>!item||typeof item!=='object'||Array.isArray(item)))
  throw new Error('Flow record collection items must be records');
 let totalLength=0;
 for(const item of value as FlowRecord[]){
  const fields=Object.entries(item);
  if(fields.filter(([field])=>!['Id','CreatedAt','LastModifiedDate','OwnerId','RecordTypeId'].includes(field)).length>100)
   throw new Error('Flow record resource exceeds the 100-field limit');
  for(const [field,fieldValue] of fields){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)
    ||fieldValue!==null&&typeof fieldValue!=='string'&&typeof fieldValue!=='number'
      &&typeof fieldValue!=='boolean'
    ||typeof fieldValue==='number'&&!Number.isFinite(fieldValue)
    ||typeof fieldValue==='string'&&fieldValue.length>4096)
    throw new Error('Invalid Flow record field value');
   totalLength+=field.length+(fieldValue===null?'':String(fieldValue)).length;
   if(totalLength>262144)throw new Error('Flow record collection exceeds the 256 KB limit');
  }
 }
 return value as FlowRecord[];
}

function sameRecord(left:FlowRecord,right:FlowRecord):boolean {
 if(typeof left.Id==='string'&&typeof right.Id==='string')return left.Id===right.Id;
 const leftKeys=Object.keys(left).filter(key=>key!=='Id'),rightKeys=Object.keys(right).filter(key=>key!=='Id');
 return leftKeys.length===rightKeys.length&&leftKeys.every(key=>Object.hasOwn(right,key)
  &&Object.is(left[key],right[key]));
}

function finiteResult(value:number):number {
 if(!Number.isFinite(value))throw new Error('Flow assignment result must be finite');
 return value;
}

export function executeFlowAssignment(input:{
 node:FlowNode;
 resources:FlowResource[];
 vars:Record<string,unknown>;
 evaluate:(value:unknown)=>unknown;
 set:(name:unknown,value:string|number|boolean|null)=>void;
 }):void {
 const {node,resources,vars,evaluate,set}=input;
 const name=node.config.variable;
 const recordField=typeof name==='string'&&/^\$Record\.[A-Za-z][A-Za-z0-9_]*$/.test(name);
 if(typeof name!=='string'||!recordField&&!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
  throw new Error('Invalid Flow variable name');
 if(recordField){
  const value=evaluate(node.config.value??null);
  if(value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')
   throw new Error('Assignment value must be scalar');
  set(name,value);
  return;
 }
 const resource=resources.find(item=>item.name===name);
 const collectionResource=resource?.type==='Record Collection';
 const operator=String(node.config.operator??'Assign');
 if(collectionResource){
  if(!resource)throw new Error('Flow collection resource is unavailable');
  const current=vars[name]===undefined?[]:records(vars[name]);
  if(operator==='Remove All'){
   vars[name]=[];
   return;
  }
  const reference=typeof node.config.value==='string'
   ?/^(?:\{!([A-Za-z][A-Za-z0-9_]*)\}|@([A-Za-z][A-Za-z0-9_]*))$/
    .exec(node.config.value.trim()):undefined;
  const sourceResource=reference
   ?resources.find(item=>item.name===(reference[1]??reference[2])):undefined;
  const expectsCollection=operator==='Assign';
  if(!sourceResource||sourceResource.dataType!==resource.dataType
    ||(expectsCollection?sourceResource.type!=='Record Collection':sourceResource.type!=='Record'))
   throw new Error('Flow collection assignment source must match its target Object');
  const value=evaluate(node.config.value??null);
  if(operator==='Assign'){
   vars[name]=records(value).map(record=>({...record}));
   return;
  }
  if(operator==='Add'||operator==='Add At Beginning'||operator==='Add At End'){
   if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Flow collection assignment requires a single record');
   records([value]);
   if(current.length>=200)throw new Error('Flow record collection exceeds the 200-record limit');
   const next=[...current];
   if(operator==='Add At Beginning')next.unshift(value as FlowRecord);
   else next.push(value as FlowRecord);
   vars[name]=next;
   return;
  }
  if(operator==='Remove'){
   if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Flow collection removal requires a single record');
   records([value]);
   const index=current.findIndex(item=>sameRecord(item,value as FlowRecord));
   if(index>=0)current.splice(index,1);
   vars[name]=current;
   return;
  }
  throw new Error('Unsupported Flow collection assignment operator: '+operator);
 }
 const value=evaluate(node.config.value??null);
 if(value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')
  throw new Error('Assignment value must be scalar');
 const previous=vars[name];
 if(operator==='Assign'){
  set(name,value);
 }else if(['Add','Subtract','Multiply','Divide'].includes(operator)){
  if(typeof previous!=='number'||typeof value!=='number')
   throw new Error('Numeric Flow assignment requires numeric values');
  if(operator==='Divide'&&value===0)throw new Error('Flow assignment cannot divide by zero');
  const result=operator==='Add'?previous+value:operator==='Subtract'?previous-value
   :operator==='Multiply'?previous*value:previous/value;
  set(name,finiteResult(result));
 }else if(operator==='Add At Beginning'||operator==='Add At End'){
  if(typeof previous!=='string'||typeof value!=='string')
   throw new Error('Text Flow assignment requires text values');
  set(name,operator==='Add At Beginning'?value+previous:previous+value);
 }else{
  throw new Error('Unsupported Flow assignment operator: '+operator);
 }
}
