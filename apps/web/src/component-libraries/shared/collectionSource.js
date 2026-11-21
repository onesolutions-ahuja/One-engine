import {Parser} from '../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../server/src/expression-engine/FormulaTokenizer.js';
import {createCriteriaFormulaCollection,deriveFormulaCollection,matchesFormulaCollectionCriterion,projectFormulaTable} from '../../../../server/src/expression-engine/FormulaCollection.js';

/**
 * A list's data source written as COLLECTION(...) or TABLE(@Object, ...): its rows.
 *
 * This is NOT a formula engine. It reads the shape of the source (which Object field
 * each entry lists, with which criterion) and builds the rows from records the page
 * already loaded with permission checks. Every VALUE inside it (a criterion such as
 * @ThisPage.Tabs.Value, a caption) is run by `value(node)`: the page's converted code.
 *
 *   COLLECTION(Name, "All", "", "*", @Product.Category = "Drinks", @Product.Name, "Hot", @Product.Category, "Hot")
 *   TABLE(@Product, @Product.Name, @Product.Price)
 *   COLLECTION(Name, @OtherCollection, criterion)     (a filtered copy of another collection)
 *
 * Returns {value:{name,items}} or {value:null,error}.
 */
export function buildCollectionSource(formula,sources={},sourceFields={},value=()=>'',namedCollections={}){
 const source=typeof formula==='string'?formula.trim().replace(/^=\s*/,''):'';
 if(!source)return {value:null,error:'Enter a collection formula'};
 try{
  const node=new Parser(tokenize(source)).parse();
  if(node.kind==='call'&&node.name==='COLLECTION')return {value:collection(node.args,sources,sourceFields,value,namedCollections)};
  if(node.kind==='call'&&node.name==='TABLE')return {value:table(node.args,sources,sourceFields)};
  return {value:null,error:'Collection formula must return a TABLE() or COLLECTION() dataset'};
 }catch(error){
  return {value:null,error:error instanceof Error?error.message:'Collection formula failed'};
 }
}

const own=(object,key)=>Boolean(object)&&Object.prototype.hasOwnProperty.call(object,key);
function sourceField(node,sources){
 if(node?.kind!=='reference')return null;
 const parts=node.value.split('.');
 if(parts.length!==2||parts.some(part=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(part)))return null;
 if(!own(sources,parts[0]))return null;
 return {object:parts[0],field:parts[1],reference:parts[0]+'.'+parts[1]};
}
function rowsFor(pointer,sources){
 const rows=sources[pointer.object];
 if(!Array.isArray(rows))throw Error('COLLECTION source unavailable: '+pointer.object);
 if(rows.length>200)throw Error('COLLECTION source exceeds 200 records');
 return rows;
}
function collection(args,sources,sourceFields,value,namedCollections){
 if(!args.length)throw Error('COLLECTION requires a name');
 const name=args[0].kind==='reference'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(args[0].value)?args[0].value:value(args[0]);
 // COLLECTION(Name, @OtherCollection, criterion): a filtered copy of a collection on this page.
 if(args.length===3&&args[1].kind==='reference'){
  const key=Object.keys(namedCollections??{}).find(item=>item.toLowerCase()===args[1].value.toLowerCase());
  if(key)return deriveFormulaCollection(name,namedCollections[key],value(args[2]));
 }
 const items=[];
 const sourceItems=(pointer,criterion,operator='')=>{
  const rows=rowsFor(pointer,sources);
  const permitted=sourceFields?.[pointer.object];
  const known=Array.isArray(permitted)?permitted.includes(pointer.field)
   :rows.some(row=>row&&typeof row==='object'&&own(row,pointer.field));
  if(!known)throw Error('COLLECTION field unavailable: '+pointer.reference);
  for(const row of rows){
   if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid COLLECTION source record');
   if(!own(row,pointer.field))continue;
   const cell=row[pointer.field],id=row.Id??row.id;
   if(cell===null||cell===undefined||String(cell).trim()==='')continue;
   if(!['string','number','boolean'].includes(typeof cell))throw Error('COLLECTION field must be scalar: '+pointer.reference);
   if(id===null||id===undefined||String(id).trim()==='')throw Error('COLLECTION source record has no ID');
   if(operator&&!matchesFormulaCollectionCriterion(cell,operator+String(criterion)))continue;
   items.push({label:String(cell),value:String(id),criteriaField:pointer.reference,
    criteria:String(cell),record:row,objectApiName:pointer.object});
   if(items.length>200)throw Error('COLLECTION exceeds 200 entries');
  }
 };
 for(let index=1;index<args.length;){
  const node=args[index];
  // "Caption", "", criterion: the caption itself is matched (no Object field).
  if(node.kind==='literal'&&typeof node.value==='string'&&index+2<args.length
    &&args[index+1].kind==='literal'&&args[index+1].value===''){
   if(matchesFormulaCollectionCriterion(node.value,value(args[index+2])))items.push(node.value);
   index+=3;continue;
  }
  // "Caption", @Object.Field, criterion: one entry that stands for the matching rows.
  if(node.kind==='literal'&&typeof node.value==='string'&&index+2<args.length&&sourceField(args[index+1],sources)){
   const pointer=sourceField(args[index+1],sources);
   const criterion=value(args[index+2]);
   if(criterion!==''&&!['string','number','boolean'].includes(typeof criterion))
    throw Error('Invalid COLLECTION criterion for '+pointer.reference);
   const matching=criterion===''?'*':String(criterion);
   items.push({label:node.value,value:matching,criteriaField:pointer.reference,criteria:matching,objectApiName:pointer.object});
   index+=3;continue;
  }
  // @Object.Field = value: every matching row.
  if(node.kind==='binary'&&['=','==','<>','!=','<','<=','>','>='].includes(node.operator)&&sourceField(node.left,sources)){
   const criterion=value(node.right);
   if(criterion===null||!['string','number','boolean'].includes(typeof criterion)
     ||typeof criterion==='number'&&!Number.isFinite(criterion))
    throw Error('COLLECTION field comparison requires a scalar criterion');
   sourceItems(sourceField(node.left,sources),criterion,node.operator);index++;continue;
  }
  // @Object.Field: every row.
  const pointer=sourceField(node,sources);
  if(pointer){sourceItems(pointer,'');index++;continue;}
  // @Object.Field of an Object this list was not given: never read from anywhere else.
  if(node.kind==='reference'&&/^(?!This(?:Page|Tenant)\.)[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/.test(node.value))
   throw Error('COLLECTION source unavailable: '+node.value.split('.')[0]);
  const result=value(node);
  if(Array.isArray(result))items.push(...result);else items.push(result);
  index++;
 }
 return createCriteriaFormulaCollection(name,items);
}
function table(args,sources,sourceFields){
 const first=args[0];
 if(first?.kind!=='reference'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(first.value))
  throw Error('TABLE first argument must be an Object source such as @Product');
 const object=Object.keys(sources??{}).find(name=>name.toLowerCase()===first.value.toLowerCase())??first.value;
 const rows=sources?.[object],permitted=sourceFields?.[object];
 if(!Array.isArray(rows)||!Array.isArray(permitted))throw Error('TABLE source is unavailable or not authorised: '+object);
 const columns=args.slice(1).map(argument=>{
  if(argument.kind!=='reference')throw Error('TABLE columns must be Object fields');
  const parts=argument.value.split('.');
  if(parts.length===1)throw Error('TABLE columns are written @'+object+'.'+argument.value+' (like every other field)');
  if(parts.length>2||parts[0].toLowerCase()!==object.toLowerCase()||parts.some(part=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(part)))
   throw Error('TABLE field does not belong to source '+object);
  return permitted.find(field=>field.toLowerCase()===parts[1].toLowerCase())??parts[1];
 });
 return projectFormulaTable(object,rows,permitted,columns);
}
