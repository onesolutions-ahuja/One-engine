import {Parser,formulaTruth} from '../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../server/src/expression-engine/FormulaTokenizer.js';
import {SQL_SCALAR_FORMULAS,SQL_RECORD_AGGREGATES,serializeFormulaSqlExpression}
 from '../../../../server/src/expression-engine/FormulaCategories.js';
import {componentReaderKey,evaluateFieldExpressionDetailed,evaluateParsedExpression} from './FieldExpression.js';

// SQL-compatible expression trees stay in one existing server request.
// Mixed trees are evaluated node-by-node without changing the formula language.
const SQL_CONDITIONS=new Set(['IF','IFERROR','AND','OR','NOT','BLANKVALUE','NULLVALUE']);
const isNamedCollection=(name,context)=>Object.keys(context.namedCollections??{})
 .some(key=>key.toLowerCase()===name.toLowerCase());
const usesPageCollection=(node,context)=>node.kind==='call'&&node.name==='SUM'&&(
 node.args[0]?.kind!=='reference'||isNamedCollection(node.args[0].value,context));
const sqlCompatible=(node,context)=>node.kind==='call'
 ?!usesPageCollection(node,context)
  &&(SQL_SCALAR_FORMULAS.has(node.name)||SQL_RECORD_AGGREGATES.has(node.name)
    ||SQL_CONDITIONS.has(node.name))
  &&node.args.every(arg=>sqlCompatible(arg,context))
 :node.kind==='unary'?sqlCompatible(node.value,context)
 :node.kind==='binary'?sqlCompatible(node.left,context)&&sqlCompatible(node.right,context)
 :true;
const containsSql=node=>node.kind==='call'
 ?SQL_SCALAR_FORMULAS.has(node.name)||SQL_RECORD_AGGREGATES.has(node.name)
  ||node.args.some(containsSql)
 :node.kind==='unary'?containsSql(node.value)
 :node.kind==='binary'?containsSql(node.left)||containsSql(node.right):false;
const scalarResult=value=>{
 if(value===null||typeof value==='string'&&value.length<=4000
   ||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))
  return value;
 throw Error('Nested Formula requires a finite scalar result');
};

/** Page Actions are already async. Convert selected functions to server SQL
 * before using their result. UI-only scalar inputs become bound SQL parameters,
 * never object-field selectors or privilege claims. */
export async function evaluatePageActionSql(request,expression,payload,pageState,objectApi,recordId,fields,sessionId='',formulaContext={}){
 const ast=new Parser(tokenize(expression)).parse();
 const authorisedCollections={...(formulaContext.namedCollections??{})};
 const local={...formulaContext,namedCollections:authorisedCollections,pageState,sessionId,
  rootObjectApiName:objectApi||formulaContext.rootObjectApiName};
 let collectionSlot=0;
 const localNode=value=>{
  if(value&&typeof value==='object'&&!Array.isArray(value)
    &&typeof value.name==='string'&&Array.isArray(value.items)){
   // Reuse the Page evaluator's typed named collection reference contract.
   let name;
   do{name='FormulaNestedValue'+collectionSlot++;}
   while(Object.keys(authorisedCollections).some(key=>key.toLowerCase()===name.toLowerCase()));
   authorisedCollections[name]=value;
   return {kind:'reference',value:name};
  }
  return {kind:'literal',value:scalarResult(value)};
 };
 const localRecord=payload&&typeof payload==='object'
  ?{...payload,state:pageState,event:payload,session:{id:sessionId}}
  :{state:pageState,event:{},session:{id:sessionId}};
 // Non-SQL-only formulas keep the existing Page expression behaviour.
 if(!containsSql(ast)){
  const result=evaluateFieldExpressionDetailed(expression,
   {state:pageState,event:payload,session:{id:sessionId}},local);
  if(result.error)throw Error('Invalid action formula: '+result.error);
  return result.value;
 }
 // The SQL request is created only when a subtree is SQL-compatible. All
 // author-supplied record identifiers and fields still use the original guard.
 const querySql=async node=>{
 const values=Object.create(null);
 const scalar=(value,label)=>{
  if(value===undefined)return null;
  if(value===null||typeof value==='string'&&value.length<=4000
    ||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))
   return value;
  throw Error('SQL formula requires a scalar '+label);
 };
 const reservedKeys=new Set(tokenize(expression)
  .filter(token=>token.kind==='reference'&&token.value.startsWith('$state.'))
  .map(token=>token.value.slice(7)));
 let sequence=0,generated=0;
 const bind=(value,label)=>{
  let key;
  do{key='SqlInput'+sequence++;}
  while(reservedKeys.has(key)||Object.prototype.hasOwnProperty.call(pageState,key));
  generated++;
  values[key]=scalar(value,label);
  return {kind:'reference',value:'$state.'+key};
 };
 const rewrite=(node,parent='',position=-1)=>{
  if(node.kind==='reference'){
   const name=node.value;
   if(name.startsWith('$event.')||name.startsWith('event.')){
    const key=name.split('.').slice(1).join('.');
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))throw Error('Invalid event field');
    return bind(payload[key],'event value');
   }
   if(name.startsWith('$component.')){
    const parts=name.split('.');
    const reader=pageState?.[componentReaderKey];
    if(parts.length!==3||typeof (reader??formulaContext.readComponent)!=='function')throw Error('Missing component value');
    return bind((reader??formulaContext.readComponent)(parts[1],parts[2]),
      'component value');
   }
   if(name==='$session'||name==='$session.id')
    return bind(sessionId,'session ID');
   if(name==='$session.cartId')
    return bind(pageState.activeCartId,'cart ID');
   if(name.startsWith('$state.')){
    const key=name.slice('$state.'.length);
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)||
      !Object.prototype.hasOwnProperty.call(pageState,key)&&!Object.prototype.hasOwnProperty.call(values,key))
     throw Error('Unknown SQL Page State reference');
    if(!Object.prototype.hasOwnProperty.call(values,key))values[key]=scalar(pageState[key],'Page State value');
    return node;
   }
   if(name.startsWith('$session.user.')||name.startsWith('$session.tenant.'))return node;
   if(SQL_RECORD_AGGREGATES.has(parent)){
    const isField=parent==='COUNTIFS'?position===0||position%2===1:
      position===0||position===1||position%2===0;
    if(isField&&/^[A-Za-z][A-Za-z0-9_]*$/.test(name))return node;
   }
   if(name.startsWith('$'))throw Error('SQL formula cannot query this UI-only reference: '+name);
   if(parent==='SUM'&&/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/.test(name))
    return node;
   const parts=name.split('.');
   if(typeof recordId!=='string'||!recordId||
     parts.length===1&&!fields.includes(parts[0])||
     parts.length===2&&(parts[0]!==objectApi||!fields.includes(parts[1]))||
     parts.length>2)throw Error('SQL formula field requires an authorised record');
   return node;
  }
  if(node.kind==='call')return {...node,args:node.args.map((a,index)=>rewrite(a,node.name,index))};
  if(node.kind==='unary')return {...node,value:rewrite(node.value,parent)};
  if(node.kind==='binary')return {...node,left:rewrite(node.left,parent),
    right:rewrite(node.right,parent)};
  return node;
 };
 // SQL children remain in SQL; only incompatible descendants resolve first.
 const prepared=await forSql(node,bind);
 const source=serializeFormulaSqlExpression(rewrite(prepared));
 if(source.length>4000||generated>30||Object.keys(values).length>40)
  throw Error('SQL formula has too many Page inputs');
 const result=await request('/formulas/evaluate',{
  method:'POST',body:JSON.stringify({formula:source,objectApi:objectApi||undefined,
   recordId:typeof recordId==='string'?recordId:undefined,state:values})
 });
 return result.value;
 };

 // A local subtree retains its original AST (including structural Object.Field
 // references in COLLECTION and TABLE). Only SQL-valued children are replaced.
 const forLocal=async node=>{
  if(node.kind==='call'){
   if(SQL_SCALAR_FORMULAS.has(node.name)||SQL_RECORD_AGGREGATES.has(node.name)){
    if(!usesPageCollection(node,formulaContext))
     return localNode(await evaluate(node));
    // SUM's authorised row expression is evaluated for each row by the existing
    // Page evaluator; SQL must not evaluate row fields out of that context.
    const operand=node.args[0];
    if(operand?.kind!=='call'&&Array.isArray(formulaContext.collectionRows)
      &&formulaContext.collectionRows.length&&operand?.kind!=='reference')
     return node;
   }
   if(['IF','IFERROR','AND','OR','BLANKVALUE','NULLVALUE'].includes(node.name)&&containsSql(node))
    return localNode(await evaluate(node));
   return {...node,args:await Promise.all(node.args.map(forLocal))};
  }
  if(node.kind==='unary')return {...node,value:await forLocal(node.value)};
  if(node.kind==='binary'){
   if((node.operator==='AND'||node.operator==='OR')&&containsSql(node))
    return localNode(await evaluate(node));
   return {...node,left:await forLocal(node.left),right:await forLocal(node.right)};
  }
  return node;
 };
 const localValue=async node=>evaluateParsedExpression(
  await forLocal(node),localRecord,local);

 // This is the only SQL/JavaScript boundary. Results cross it as bound values,
 // not as string-interpolated SQL, and Object/Field metadata is never rebound.
 const forSql=async(node,bind)=>{
  if(sqlCompatible(node,formulaContext))return node;
  if(node.kind==='call'){
   if(usesPageCollection(node,formulaContext)||
     !SQL_SCALAR_FORMULAS.has(node.name)&&
     !SQL_RECORD_AGGREGATES.has(node.name)&&!SQL_CONDITIONS.has(node.name)||
     ['IF','IFERROR','AND','OR','BLANKVALUE','NULLVALUE'].includes(node.name))
    return bind(scalarResult(await evaluate(node)),'nested formula result');
   return {...node,args:await Promise.all(node.args.map(arg=>forSql(arg,bind)))};
  }
  if(node.kind==='binary'&&(node.operator==='AND'||node.operator==='OR'))
   return bind(scalarResult(await evaluate(node)),'nested Boolean result');
  if(node.kind==='unary')return {...node,value:await forSql(node.value,bind)};
  if(node.kind==='binary')return {...node,left:await forSql(node.left,bind),
   right:await forSql(node.right,bind)};
  return node;
 };
 // Conditional operators have lazy semantics even when execution crosses SQL.
 const evaluate=async node=>{
  if(sqlCompatible(node,formulaContext)&&containsSql(node))return querySql(node);
  if(node.kind==='call'){
   const name=node.name;
   if(name==='IF'){
    if(node.args.length!==3)throw Error('Invalid IF formula arguments');
    return evaluate(formulaTruth(await evaluate(node.args[0]))?node.args[1]:node.args[2]);
   }
   if(name==='IFERROR'){
    if(node.args.length!==2)throw Error('Invalid IFERROR formula arguments');
    try{return await evaluate(node.args[0]);}
    catch{return evaluate(node.args[1]);}
   }
   if(name==='AND'||name==='OR'){
    for(const arg of node.args){
     const truth=formulaTruth(await evaluate(arg));
     if(name==='AND'&&!truth)return false;
     if(name==='OR'&&truth)return true;
    }
    return name==='AND';
   }
   if(name==='BLANKVALUE'||name==='NULLVALUE'){
    if(node.args.length!==2)throw Error('Invalid blank fallback formula arguments');
    const value=await evaluate(node.args[0]);
    return value===null||value===undefined||name==='BLANKVALUE'&&value===''
     ?evaluate(node.args[1]):value;
   }
   if(SQL_SCALAR_FORMULAS.has(name)||SQL_RECORD_AGGREGATES.has(name))
    return usesPageCollection(node,formulaContext)?localValue(node):querySql(node);
   return localValue(node);
  }
  if(node.kind==='binary'&&(node.operator==='AND'||node.operator==='OR')){
   const first=formulaTruth(await evaluate(node.left));
   if(node.operator==='AND'&&!first)return false;
   if(node.operator==='OR'&&first)return true;
   return formulaTruth(await evaluate(node.right));
  }
  return containsSql(node)?querySql(node):localValue(node);
 };
 return evaluate(ast);
}
