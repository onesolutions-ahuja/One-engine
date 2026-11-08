import {evaluateFlowDecisionOutcome} from '../system-files/flow-decision-runtime.js';
import {evaluateFlowCollectionStep} from '../system-files/flow-data-actions.js';
import {executeFlowAssignment} from '../system-files/flow-assignment-runtime.js';
import {evaluateFlowFormula,isFormulaImageResult,type FormulaEvaluationContext}
  from '../system-files/flow-formula-runtime.js';
import {flowFormulaReferences} from '../expression-engine/FormulaDependencyGraph.js';

type Node={id:number;type:string;label?:string;config:Record<string,unknown>};
type Edge={from:number;to:number;label?:string;kind?:string};
type Dict=Record<string,unknown>;
type Query=(object:string,conditions:Array<{field:unknown;operator:unknown;value?:unknown}>,
  logic:string|undefined,options:{sortField?:string;sortOrder?:string;limit:number})=>Promise<Dict[]>;

const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
const scalar=(value:unknown):value is string|number|boolean|null=>
  value===null||typeof value==='string'||typeof value==='boolean'
  ||typeof value==='number'&&Number.isFinite(value);
const record=(value:unknown):value is Dict=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);
const secret=/password|secret|token|credential|authorization|api.?key|private.?key/i;

export function flowDebugResources(value:unknown):Array<{
  name:string;type:string;dataType:string;isCollection?:boolean;value?:unknown
}> {
  if(!Array.isArray(value))return [];
  return value.flatMap(item=>record(item)&&typeof item.name==='string'
    &&typeof item.type==='string'&&typeof item.dataType==='string'
    ?[{name:item.name,type:item.type,dataType:item.dataType,
      ...(typeof item.isCollection==='boolean'?{isCollection:item.isCollection}:{}),
      ...(Object.hasOwn(item,'value')?{value:item.value}:{})}]
    :[]);
}

/** Bounded snapshots never include credential-like values or unbounded record bodies. */
export function flowDebugSnapshot(value:unknown,depth=0):unknown {
  if(depth>3)return '[Depth limit]';
  if(typeof value==='string')return value.length>240?value.slice(0,240)+'…':value;
  if(scalar(value))return value;
  if(Array.isArray(value))return [
    ...value.slice(0,10).map(item=>flowDebugSnapshot(item,depth+1)),
    ...(value.length>10?['['+(value.length-10)+' more]']:[])
  ];
  if(record(value))return Object.fromEntries(Object.entries(value).slice(0,30)
    .map(([key,item])=>[key,secret.test(key)?'[Redacted]':flowDebugSnapshot(item,depth+1)]));
  return '[Unsupported value]';
}

export type FlowDebugStep={
  step:number;elementApiName:string;type:string;status:'Completed'|'Simulated'|'Waiting'|'Failed';
  durationMs:number;variables:unknown;details?:string;
};

export async function simulateFlowGraph(options:{
  apiName:string;version:number;flowType:string;nodes:Node[];edges:Edge[];
  inputs:unknown;recordTriggered:boolean;
  resources?:Array<{name:string;type:string;dataType:string;isCollection?:boolean;value?:unknown}>;
  formulaContext?:FormulaEvaluationContext;userResource?:Dict;
  findRecords?:Query;
  /** Provided by authenticated Flow Runtime; no side effects or record writes. */
  evaluateSql?:(source:string,resolve:(reference:string)=>unknown,
    context:FormulaEvaluationContext)=>Promise<unknown>;
}){
  const {apiName,version,flowType,nodes,edges,inputs,recordTriggered,findRecords,
    formulaContext,userResource}=options;
  if(!record(inputs)||Object.keys(inputs).length>100
    ||JSON.stringify(inputs).length>32768)throw new Error('Invalid or oversized debug inputs');
  if(recordTriggered&&flowType!=='Record-Triggered Flow')
    throw new Error('Record debug requires a Record-Triggered Flow');
  const starts=nodes.filter(node=>node.type==='Start');
  if(starts.length!==1)throw new Error('Invalid Flow Start');
  const graph=new Map(nodes.map(node=>[node.id,node]));
  if(nodes.length>250||edges.length>500||graph.size!==nodes.length)
    throw new Error('Invalid debug graph size');
  const resources=[...(options.resources??[])];
  for(const node of nodes){
    const objectApi=String(node.config.object??'');
    const output=node.type==='Get Records'
      ?typeof node.config.outputVariable==='string'&&node.config.outputVariable
        ?node.config.outputVariable:'record'+node.id
      :node.type==='Create Records'&&node.config.recordSource==='collection'
        &&typeof node.config.resultVariable==='string'?node.config.resultVariable:'';
    if(output&&!resources.some(resource=>resource.name===output)&&identifier.test(objectApi)){
      const collection=node.type==='Get Records'
        ?node.config.recordLimit==='all'||Number(node.config.recordLimit??1)>1:true;
      resources.push({name:output,type:collection?'Record Collection':'Record',dataType:objectApi});
    }
  }
  for(const node of nodes){
    if(node.type!=='Loop'||typeof node.config.loopVariable!=='string')continue;
    const source=resources.find(resource=>resource.name===node.config.collection
      &&resource.type==='Record Collection');
    if(source&&!resources.some(resource=>resource.name===node.config.loopVariable))
      resources.push({name:node.config.loopVariable,type:'Record',dataType:source.dataType});
  }
  const vars:Dict=Object.create(null) as Dict;
  if(userResource)vars.$User=structuredClone(userResource);
  let event='created',prior:Dict|null=null;
  if(recordTriggered){
    if(!record(inputs.record))throw new Error('Current debug record must be an object');
    if(inputs.prior!==undefined&&!record(inputs.prior))throw new Error('Prior debug record must be an object');
    event=String(inputs.event??'created');
    if(!['created','updated','deleted'].includes(event))
      throw new Error('Invalid debug event');
    prior=record(inputs.prior)?structuredClone(inputs.prior):null;
    vars.$Record=structuredClone(inputs.record);
    vars.$Record__Prior=prior;
    vars.$Event=event;
    vars.$IsClone=inputs.isClone===true;
  }else for(const [key,value] of Object.entries(inputs)){
    if(!identifier.test(key)||!scalar(value)&&!record(value)&&!Array.isArray(value))
      throw new Error('Invalid debug resource');
    vars[key]=structuredClone(value);
  }
  const formulaStack=new Set<string>();
  const precomputed=new Set<string>();
  const formulaResources=new Map(resources.filter(x=>x.type==='Formula').map(x=>[x.name,x]));
  const resolveResource=(name:string):unknown=>{
    const [resource,...path]=name.split('.');
    if(!Object.hasOwn(vars,resource)){
      const definition=resources.find(item=>item.name===resource);
      if(!definition)throw new Error('Unknown debug resource: '+resource);
      if(definition.type==='Formula'){
        if(options.evaluateSql)throw new Error('Debug Formula must be prepared through SQL: '+resource);
        if(formulaStack.has(resource))throw new Error('Circular Flow formula reference: '+resource);
        if(typeof definition.value!=='string')
          throw new Error('Flow formula resource has no expression: '+resource);
        formulaStack.add(resource);
        try{
          const evaluated=evaluateFlowFormula(definition.value,resolveResource,formulaContext);
          const value=isFormulaImageResult(evaluated)?evaluated.url:evaluated;
          if(['Number','Currency','Percent'].includes(definition.dataType)
            &&(typeof value!=='number'||!Number.isFinite(value)))
            throw new Error('Flow formula did not return a finite number: '+resource);
          if(['Boolean','Checkbox'].includes(definition.dataType)&&typeof value!=='boolean')
            throw new Error('Flow formula did not return a Boolean: '+resource);
          if(!['Boolean','Checkbox','Number','Currency','Percent'].includes(definition.dataType)
            &&value!==null&&typeof value!=='string')
            throw new Error('Flow formula did not return text: '+resource);
          vars[resource]=value;
        }finally{
          formulaStack.delete(resource);
        }
      }else if(definition.type==='Constant'||definition.type==='Choice'){
        const value=definition.value??null;
        if(['Number','Currency','Percent'].includes(definition.dataType)){
          const parsed=typeof value==='number'?value:Number(value);
          if(!Number.isFinite(parsed))throw new Error('Invalid Flow constant: '+resource);
          vars[resource]=parsed;
        }else if(['Boolean','Checkbox'].includes(definition.dataType)){
          if(typeof value==='boolean')vars[resource]=value;
          else if(value==='true'||value==='false')vars[resource]=value==='true';
          else throw new Error('Invalid Flow constant: '+resource);
        }else if(scalar(value))vars[resource]=value;
        else throw new Error('Invalid Flow constant: '+resource);
      }else if(definition.type==='Text Template'){
        if(typeof definition.value!=='string')
          throw new Error('Flow text template has no text: '+resource);
        vars[resource]=definition.value.replace(/\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/g,
          (_match,reference:string)=>{
            const value=resolveResource(reference);
            if(value!==null&&value!==undefined&&!scalar(value))
              throw new Error('Text template references a non-scalar resource');
            return value===null||value===undefined?'':String(value);
          });
      }else throw new Error('Unknown Flow resource: '+resource);
    }
    let value=vars[resource];
    for(const segment of path){
      if(!record(value)||!Object.hasOwn(value,segment))
        throw new Error('Unknown debug field: '+segment);
      value=value[segment];
    }
    return value;
  };
  /** Resolve only Formula resources consumed by the current debug step using
   * the same shared SQL compiler as live Flow execution. */
  const prepareFormula=async(name:string):Promise<void>=>{
    if(precomputed.has(name))return;
    const resource=formulaResources.get(name);
    if(!resource)return;
    if(formulaStack.has(name))throw Error('Circular Flow formula reference: '+name);
    if(typeof resource.value!=='string')throw Error('Flow formula resource has no expression: '+name);
    formulaStack.add(name);
    try{
      for(const reference of flowFormulaReferences(resource.value)){
        const dependency=reference.split('.')[0];
        if(formulaResources.has(dependency))await prepareFormula(dependency);
      }
      const raw=options.evaluateSql?await options.evaluateSql(resource.value,resolveResource,
        formulaContext??{}):evaluateFlowFormula(resource.value,resolveResource,formulaContext);
      const value=isFormulaImageResult(raw)?raw.url:raw;
      if(['Number','Currency','Percent'].includes(resource.dataType)&&
        (typeof value!=='number'||!Number.isFinite(value)))
        throw Error('Debug formula did not return a finite number: '+name);
      if(['Boolean','Checkbox'].includes(resource.dataType)&&typeof value!=='boolean')
        throw Error('Debug formula did not return Boolean: '+name);
      vars[name]=value;
      precomputed.add(name);
    }finally{formulaStack.delete(name);}
  };
  const prepareFormulasFor=async(node:Node)=>{
    if(!options.evaluateSql)return;
    for(const name of formulaResources.keys())delete vars[name];
    precomputed.clear();
    const sources=[JSON.stringify(node.config)];
    for(const template of resources.filter(x=>x.type==='Text Template'))
      if(sources.some(s=>s.includes(template.name)))sources.push(String(template.value??''));
    for(const name of formulaResources.keys()){
      const referenced=sources.some(s=>s.includes('@'+name)||s.includes('{!'+name)
        ||s.includes('"'+name+'"'));
      if(referenced||node.type==='End')
        await prepareFormula(name);
    }
  };
  const resolve=(value:unknown):unknown=>{
    if(typeof value!=='string')return value;
    const match=value.match(/^\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}$/)
      ??value.match(/^@([A-Za-z_$][A-Za-z0-9_$.]*)$/);
    return match?resolveResource(match[1]):value;
  };
  const conditions=(items:unknown):Array<{field:unknown;operator:unknown;value?:unknown}>=>{
    if(!Array.isArray(items))return [];
    return items.map(item=>{
      if(!record(item))throw new Error('Invalid debug condition');
      const value=item.value===undefined?undefined:resolve(item.value);
      if(value!==undefined&&!scalar(value))throw new Error('Debug filter values must be scalar');
      return {field:item.field,operator:item.operator,value};
    });
  };
  const match=(conditionRows:unknown,logic:unknown,source?:Dict)=>{
    if(!Array.isArray(conditionRows)||conditionRows.length===0)return true;
    const rows=conditionRows.filter(record).map(item=>
      source&&typeof item.field==='string'&&Object.hasOwn(source,item.field)
        ?{...item,field:source[item.field]}:item);
    return evaluateFlowDecisionOutcome(rows,
      typeof logic==='string'?logic:undefined,resolve,
      value=>typeof value==='string'&&Object.hasOwn(vars,value));
  };
  const trace:FlowDebugStep[]=[];
  const base={flowApiName:apiName,flowVersion:version,dryRun:true,sideEffectsSimulated:true};
  const finish=(status:'completed'|'waiting'|'failed'|'skipped',extra:Dict={})=>({
    ...base,status,outputs:flowDebugSnapshot(vars),variables:flowDebugSnapshot(vars),
    debugTrace:trace,...extra
  });
  const loopOffsets=new Map<number,number>();
  let current=starts[0].id;
  for(let step=0;step<200;step++){
    const node=graph.get(current);
    if(!node)throw new Error('Missing debug Flow element');
    await prepareFormulasFor(node);
    const start=Date.now();
    let status:FlowDebugStep['status']='Completed',details:string|undefined;
    let outcome:string|undefined,halt:'waiting'|'failed'|'skipped'|undefined;
    try{
      const config=record(node.config)?node.config:{};
      if(node.type==='Start'&&recordTriggered){
        const operation=String(config.trigger??'created-or-updated');
        const matching=operation==='created-or-updated'?event!=='deleted':operation===event;
        if(!matching||!match(config.entryConditions,config.conditionLogic,vars.$Record as Dict)){
          halt='skipped';details='Trigger event or entry conditions did not match';
        }
      }else if(node.type==='End') {
        details='Flow completed (no changes saved)';
      }else if(node.type==='Screen'){
        status='Waiting';halt='waiting';details='Screen display simulated';
      }else if(node.type==='Orchestration Stage'){
        status='Waiting';halt='waiting';
        details='Human approval stage simulated; no approval request created or delivered';
      }else if(node.type==='Assignment'){
        executeFlowAssignment({node,resources,vars,evaluate:resolve,
          set:(key,value)=>{
            const field=/^\$Record\.([A-Za-z][A-Za-z0-9_]*)$/.exec(String(key));
            if(field&&record(vars.$Record))vars.$Record[field[1]]=value;
            else if(identifier.test(String(key)))vars[String(key)]=value;
            else throw new Error('Invalid Assignment variable');
          }});
      }else if(node.type==='Decision'){
        const choices=Array.isArray(config.outcomes)?config.outcomes.filter(record):[];
        const matched=choices.find(choice=>choice.name!=='Default'
          &&Array.isArray(choice.conditions)&&choice.conditions.length>0
          &&match(choice.conditions,choice.conditionLogic));
        outcome=String(matched?.label??matched?.name??'Default');
        details='Selected outcome: '+outcome;
      }else if(node.type==='Loop'){
        const items=vars[String(config.collection??'')];
        if(!Array.isArray(items)||items.length>200)throw new Error('Loop needs a bounded collection');
        const direction=config.direction==='Last to first'?-1:1;
        const index=loopOffsets.get(node.id)??(direction===1?0:items.length-1);
        if(index<0||index>=items.length){
          loopOffsets.delete(node.id);outcome='After Last';
        }else{
          if(!record(items[index]))throw new Error('Loop requires record items');
          const key=String(config.loopVariable??'');
          if(!identifier.test(key))throw new Error('Invalid Loop variable');
          vars[key]=items[index];loopOffsets.set(node.id,index+direction);outcome='For Each';
        }
        details='Selected loop path: '+outcome;
      }else if(['Collection Filter','Collection Sort','Transform'].includes(node.type)){
        const output=String(config.outputCollection??'');
        if(!identifier.test(output))throw new Error('Invalid collection output variable');
        vars[output]=evaluateFlowCollectionStep(node.type,config,
          vars[String(config.collection??'')],resolve);
      }else if(node.type==='Get Records'){
        const object=String(config.object??'');
        if(!identifier.test(object))throw new Error('Invalid query object');
        const raw=config.recordLimit??1,limit=raw==='all'?200:Number(raw);
        if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('Invalid debug query limit');
        if(!findRecords)throw new Error('Debug read-only record query is unavailable');
        const rows=await findRecords(object,conditions(config.conditions),
          typeof config.conditionLogic==='string'?config.conditionLogic:undefined,
          {limit,sortField:typeof config.sortField==='string'&&config.sortField||undefined,
            sortOrder:typeof config.sortOrder==='string'?config.sortOrder:undefined});
        const output=String(config.outputVariable||'record'+node.id);
        if(!identifier.test(output))throw new Error('Invalid Get Records output variable');
        vars[output]=limit===1?rows[0]??null:rows;
        details='Read '+rows.length+' record(s) under current tenant and field permissions';
      }else if(['Create Records','CreateRecord','Update Records','Delete Records','Action',
        'HTTP Callout','Subflow','Publish Platform Event','Roll Back Records'].includes(node.type)){
        status='Simulated';
        details='Side effect or nested execution skipped; no SQL write, network call or message sent';
      }else if(node.type==='Wait'){
        status='Waiting';halt='waiting';
        details='Durable wait simulated; no resume job scheduled';
      }else if(node.type==='Custom Error'){
        status='Failed';halt='failed';
        details=String(config.errorMessage??'Flow Custom Error').slice(0,500);
      }else if(node.type!=='Start'){
        throw new Error('Unsupported Flow debug element: '+node.type);
      }
    }catch(error){
      status='Failed';halt='failed';
      details=error instanceof Error?error.message:'Flow debug step failed';
    }
    trace.push({step:step+1,elementApiName:'step_'+node.id,type:node.type,status,
      durationMs:Math.max(0,Date.now()-start),variables:flowDebugSnapshot(vars),...(details?{details}:{})});
    if(halt)return finish(halt,{reason:details,
      ...(node.type==='Screen'?{screen:node,kind:'screen'}:
        node.type==='Wait'?{kind:'wait'}:
        node.type==='Orchestration Stage'?{kind:'orchestration'}:{})});
    if(node.type==='End')return finish('completed');
    const available=edges.filter(edge=>edge.from===current&&(edge.kind===undefined||edge.kind==='normal'));
    const next=outcome
      ?available.find(edge=>edge.label===outcome)
        ??available.find(edge=>edge.label==='Default')
      :available.find(edge=>!edge.label||edge.label==='Default')
        ??(available.length===1?available[0]:undefined);
    if(!next){
      trace.push({step:step+2,elementApiName:'step_'+node.id,type:node.type,status:'Failed',
        durationMs:0,variables:flowDebugSnapshot(vars),details:'Missing connected Flow path'});
      return finish('failed',{reason:'Missing connected Flow path'});
    }
    current=next.to;
  }
  return finish('failed',{reason:'Flow debug exceeded 200 steps'});
}
