import type { FieldMetadata, FlowDefinitionMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';

/** No-code typing shortcuts shared with the Page Builder formula bar:
 * @ = record data fields, $ = signed-in user, session and system values,
 * ! = values created inside this Flow (variables, formulas and step outputs).
 * The stored runtime syntax stays {!Name}; the symbol is only how users find it. */
export type FlowReferenceSymbol = '@' | '$' | '!';
export const flowReferenceSymbols: ReadonlyArray<{symbol:FlowReferenceSymbol;label:string;hint:string}> = [
  {symbol:'@',label:'Record fields',hint:'Trigger record, records found or created by earlier steps, loop items'},
  {symbol:'$',label:'User & system',hint:'Signed-in user and error details on fault paths'},
  {symbol:'!',label:'Flow values',hint:'Variables, formulas, screen inputs and outputs of earlier steps'}
];
export function flowReferenceSymbol(reference:string):FlowReferenceSymbol {
  const name=/^\{!?([A-Za-z_$][A-Za-z0-9_$.]*)\}$/.exec(reference.trim())?.[1]??'';
  if(/^\$Record(?:__Prior)?\./.test(name))return '@';
  if(name.startsWith('$'))return '$';
  return name.includes('.')?'@':'!';
}

export type FlowReferenceChoice = {
  reference: string;
  label: string;
  detail: string;
  category: 'Earlier steps' | 'Flow inputs and variables' | 'Trigger record' | 'User and system';
  symbol?: FlowReferenceSymbol;
  dataType: string;
  targetObject?: string;
  unavailableReason?: string;
};
const specialFields = [{apiName:'Id',label:'Record ID',dataType:'Id'},
  {apiName:'CreatedDate',label:'Created Date',dataType:'DateTime'}];

/** A node's output can only be suggested if every route to the current node passes through it. */
export function precedingFlowSteps(flow: FlowDefinitionMetadata, elementId: number): Set<number> {
  const ids = new Set(flow.elements.map(item => item.id));
  const start = flow.elements.find(item => item.type === 'Start')?.id;
  if (start === undefined || !ids.has(elementId)) return new Set();
  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();
  for (const edge of flow.connectors) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.set(edge.to,[...(incoming.get(edge.to) ?? []),edge.from]);
    outgoing.set(edge.from,[...(outgoing.get(edge.from) ?? []),edge.to]);
  }
  const reachable = new Set<number>([start]);
  const queue=[start];
  while(queue.length){for(const id of outgoing.get(queue.shift()!) ?? [])if(!reachable.has(id)){reachable.add(id);queue.push(id)}}
  if(!reachable.has(elementId))return new Set();
  const dominant = new Map<number,Set<number>>();
  for(const id of reachable)dominant.set(id,id===start?new Set([start]):new Set(reachable));
  let changed=true;
  while(changed){
    changed=false;
    for(const id of reachable){
      if(id===start)continue;
      const preds=(incoming.get(id) ?? []).filter(parent=>reachable.has(parent));
      if(!preds.length)continue;
      const common=new Set(dominant.get(preds[0]));
      for(const pred of preds.slice(1))for(const x of common)if(!dominant.get(pred)?.has(x))common.delete(x);
      common.add(id);
      const before=dominant.get(id)!;
      if(common.size!==before.size||[...common].some(x=>!before.has(x))){dominant.set(id,common);changed=true}
    }
  }
  const earlier=dominant.get(elementId) ?? new Set<number>();
  earlier.delete(elementId);
  return earlier;
}

/** Relationship metadata may be represented by a typed Lookup(Target) field. */
function lookupTarget(type:string):string|undefined {
  return /^(?:Lookup|Master-Detail)\(([^)]+)\)$/i.exec(type.trim())?.[1]?.trim();
}

function primitiveType(type:string): string {
  if(type.startsWith('Lookup(')||type.startsWith('Master-Detail('))return 'lookup';
  if(/^(Number|Currency|Percent)(\(|$)/i.test(type))return 'number';
  if(/^(Checkbox|Boolean)$/i.test(type))return 'boolean';
  if(type==='Date'||type==='DateTime'||type==='Date/Time')return type;
  if(type==='Id')return 'id';
  return 'text';
}

/** Limit selectable sources to compatible, existing typed metadata. */
export function compatibleFlowValue(source:Pick<FlowReferenceChoice,'dataType'|'targetObject'>,target?:FieldMetadata,targetObjectApiName?:string):boolean {
  if(!target)return true;
  const need=primitiveType(target.dataType);
  const got=primitiveType(source.dataType);
  const destination=target.relationship?.targetObject||lookupTarget(target.dataType);
  const sourceObject=source.targetObject||lookupTarget(source.dataType);
  if(need==='lookup')return (got==='id'||got==='lookup') && Boolean(destination)
    && (!sourceObject || destination===sourceObject)
    && (got!=='lookup'||Boolean(sourceObject));
  if(need==='id')return got==='id' ? (!targetObjectApiName||!sourceObject||sourceObject===targetObjectApiName)
    : got==='lookup'&&Boolean(sourceObject)&&sourceObject===targetObjectApiName;
  if(need==='number'||need==='boolean')return got===need;
  if(need==='Date'||need==='DateTime'||need==='Date/Time')return need===got;
  return got==='text'||got==='id';
}

export function flowReferenceChoices(flow:FlowDefinitionMetadata,elementId:number,objects:readonly ObjectMetadata[],target?:FieldMetadata,targetObjectApiName?:string):FlowReferenceChoice[]{
  const result:FlowReferenceChoice[]=[];
  const recordChoices=(root:string,label:string,objectName:string,category:FlowReferenceChoice['category'],storedFields?:readonly string[])=>{
    const obj=objects.find(item=>item.apiName===objectName);
    if(!obj)return;
    const fields=[...specialFields,...obj.fields.filter(field=>!specialFields.some(s=>s.apiName===field.apiName))];
    for(const field of fields){
      const linkedObject=obj.fields.find(candidate=>candidate.apiName===field.apiName)?.relationship?.targetObject||lookupTarget(field.dataType);
      const choice:FlowReferenceChoice={reference:`{!${root}.${field.apiName}}`,label:label+' → '+field.label,
        detail:root+'.'+field.apiName+' · '+obj.label,category,dataType:field.dataType,
        ...(field.apiName==='Id'?{targetObject:objectName}
          :linkedObject?{targetObject:linkedObject}:{}),
        ...(storedFields && !specialFields.some(s=>s.apiName===field.apiName) &&
          !storedFields.includes(field.apiName)
          ?{unavailableReason:field.label+' is not in Get Records → Fields to Store. Add it to that step first.'}:{})};
      if(compatibleFlowValue(choice,target,targetObjectApiName))result.push(choice);
    }
  };
  // Shared user reporting references are available in any Flow context without
  // building separate roles, records, or app-specific Flow nodes.
  for(const field of [
    {reference:'{!$User.Id}',label:'Current user ID'},
    {reference:'{!$User.ManagerId}',label:'Current user reporting manager'}
  ]){
    const choice:FlowReferenceChoice={...field,detail:field.reference.slice(2,-1)+' · User',
      category:'User and system',dataType:'Id',targetObject:'User'};
    if(compatibleFlowValue(choice,target,targetObjectApiName))result.push(choice);
  }
  if(flow.triggerObject && ['Record-Triggered Flow','Schedule-Triggered Flow'].includes(flow.flowType))
    recordChoices('$Record','Trigger record',flow.triggerObject,'Trigger record');
  if(flow.triggerObject&&flow.flowType==='Record-Triggered Flow')
    recordChoices('$Record__Prior','Prior trigger record',flow.triggerObject,'Trigger record');
  // A variable filled only by a step that has not run yet is not offered here.
  const earlierSteps=precedingFlowSteps(flow,elementId);
  const pendingOutputs=new Set<string>();
  const readyOutputs=new Set<string>();
  for(const element of flow.elements){
    if(element.type==='Assignment')for(const name of JSON.stringify(element.config).match(/[A-Za-z][A-Za-z0-9_]*/g)??[])
      readyOutputs.add(name);
    for(const output of flowStepOutputs(element,flow.resources))
      (earlierSteps.has(element.id)?readyOutputs:pendingOutputs).add(output.name);
  }
  for(const resource of flow.resources){
    if(pendingOutputs.has(resource.name)&&!readyOutputs.has(resource.name)
      &&resource.value===undefined&&!resource.availableForInput)continue;
    if(resource.type==='Record'){
      if(resource.availableForInput)recordChoices(resource.name,resource.label,resource.dataType,'Flow inputs and variables');
    }else if(resource.type!=='Record Collection'){
      const choice:FlowReferenceChoice={reference:`{!${resource.name}}`,label:resource.label,
        detail:resource.name+' · '+resource.dataType,category:'Flow inputs and variables',dataType:resource.dataType};
      if(compatibleFlowValue(choice,target,targetObjectApiName))result.push(choice);
    }
  }
  const earlier=precedingFlowSteps(flow,elementId);
  const resourceNames=new Set(flow.resources.map(resource=>resource.name));
  const screenFields=(element:FlowDefinitionMetadata['elements'][number])=>{
    const fields=Array.isArray(element.config.fields)?element.config.fields:[];
    for(const field of fields){
      if(!field||typeof field!=='object'||Array.isArray(field))continue;
      const item=field as Record<string,unknown>;
      const name=typeof item.apiName==='string'?item.apiName
        :String(item.label??'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'');
      if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)||resourceNames.has(name))continue;
      const type=String(item.type??'Text');
      if(['Display Text','Display Image','Section','Address','Name','Data Table',
        'File Upload','Repeater','Custom Component','Multi-Select Picklist'].includes(type)
        ||(type==='Choice Lookup'&&item.multipleSelections===true))continue;
      const lookup=type==='Lookup'||type==='Choice Lookup';
      const targetObject=lookup?String(item.objectApiName??''):undefined;
      if(lookup&&!objects.some(object=>object.apiName===targetObject))continue;
      const choice:FlowReferenceChoice={
        reference:`{!${name}}`,label:element.label+' → '+String(item.label||name),
        detail:name+' · '+(lookup?'Record ID ('+targetObject+')':type)+' · Screen input',
        category:'Earlier steps',dataType:lookup?'Id':type,
        ...(targetObject?{targetObject}:{})
      };
      if(compatibleFlowValue(choice,target,targetObjectApiName))result.push(choice);
    }
  };
  for(const element of flow.elements){
    if(!earlier.has(element.id))continue;
    if(element.type==='Screen')screenFields(element);
    if(element.type==='Get Records'){
      const name=String(element.config.outputVariable||`element${element.id}`);
      const type=String(element.config.object||'');
      const limit=String(element.config.recordLimit||'1');
      if(limit==='1')recordChoices(name,element.label,type,'Earlier steps',
        Array.isArray(element.config.fields)?element.config.fields.filter((f):f is string=>typeof f==='string'):undefined);
    }
    if(element.type==='Create Records' && element.config.recordSource!=='collection')
      recordChoices(`record${element.id}`,element.label,String(element.config.object||''),'Earlier steps');
    if(element.type==='Loop'){
      const name=String(element.config.loopVariable||'');
      const collectionName=String(element.config.collection||'');
      const collection=flow.resources.find(resource=>resource.name===collectionName&&resource.isCollection);
      const getSource=flow.elements.find(step=>step.type==='Get Records'
        &&String(step.config.outputVariable||`element${step.id}`)===collectionName
        &&String(step.config.recordLimit??'1')!=='1');
      const candidate=String(collection?.dataType||'');
      const getObject=String(getSource?.config.object||'');
      const objectName=objects.some(object=>object.apiName===candidate)?candidate
        :objects.some(object=>object.apiName===getObject)?getObject:'';
      if(objectName)recordChoices(name,element.label,objectName,'Earlier steps',
        getSource&&Array.isArray(getSource.config.fields)
          ?getSource.config.fields.filter((f):f is string=>typeof f==='string'):undefined);
    }
  }
  for(const element of flow.elements){
    if(!earlier.has(element.id))continue;
    for(const output of flowStepOutputs(element,flow.resources)){
      const choice:FlowReferenceChoice={reference:`{!${output.name}}`,
        label:element.label+' → '+output.label,
        detail:output.name+' · '+output.dataType+' · output of '+element.label,
        category:'Earlier steps',dataType:output.dataType};
      if(compatibleFlowValue(choice,target,targetObjectApiName))result.push(choice);
    }
  }
  // Fault connectors expose the error text of the failed step.
  for(const [name,label] of [['FaultMessage','Error message'],['FaultCode','Error code']]){
    const choice:FlowReferenceChoice={reference:`{!$Flow.${name}}`,label:'Flow error → '+label,
      detail:'$Flow.'+name+' · Text · set on fault paths',category:'User and system',dataType:'Text'};
    if(compatibleFlowValue(choice,target,targetObjectApiName))result.push(choice);
  }
  const unique=new Map<string,FlowReferenceChoice>();
  for(const choice of result)unique.set(choice.reference,{...choice,symbol:flowReferenceSymbol(choice.reference)});
  return [...unique.values()];
}

/** Values a step writes for later steps, read from the step's own metadata. */
export function flowStepOutputs(element:FlowDefinitionMetadata['elements'][number],
  resources:FlowDefinitionMetadata['resources']):Array<{name:string;label:string;dataType:string}>{
  const config=element.config;
  const outputs:Array<{name:string;label:string}>=[];
  const add=(name:unknown,label:string)=>{
    const value=typeof name==='string'?name.replace(/^\{!?|\}$/g,'').replace(/^@/,'').trim():'';
    if(/^[A-Za-z][A-Za-z0-9_]*$/.test(value))outputs.push({name:value,label});
  };
  add(config.statusVariable,element.type==='HTTP Callout'?'Status code':'Status');
  add(config.responseVariable,'Full response');
  add(config.outputVariable,'Result');
  if(typeof config.responseMapping==='string'&&config.responseMapping.trim()){
    try{
      const mapping=JSON.parse(config.responseMapping) as unknown;
      if(mapping&&typeof mapping==='object'&&!Array.isArray(mapping))
        for(const [name,path] of Object.entries(mapping))add(name,'Response → '+String(path));
    }catch{/* An unfinished mapping simply has no outputs yet. */}
  }
  if(Array.isArray(config.assignments))for(const item of config.assignments){
    if(item&&typeof item==='object'&&!Array.isArray(item)){
      const row=item as Record<string,unknown>;
      add(row.outputVariable,'JSON → '+String(row.path??''));
    }
  }
  if(typeof config.outputValues==='string')for(const line of config.outputValues.split(/\r?\n/)){
    const separator=line.indexOf('=');
    if(separator>0)add(line.slice(separator+1),'Subflow → '+line.slice(0,separator).trim());
  }
  const seen=new Set<string>();
  return outputs.flatMap(output=>{
    const resource=resources.find(item=>item.name===output.name);
    if(seen.has(output.name)||!resource||resource.isCollection
      ||resource.type==='Record'||resource.type==='Record Collection')return [];
    seen.add(output.name);
    return [{...output,dataType:resource.dataType}];
  });
}

export const flowReferencePattern=/^\{!?([A-Za-z_$][A-Za-z0-9_$.]*)\}$/;
export function referenceName(value:unknown):string|undefined {
  return typeof value==='string'?flowReferencePattern.exec(value.trim())?.[1]:undefined;
}
