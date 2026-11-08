import {useEffect,useState} from 'react';
import {visiblePageCollectionResult} from './pageCollectionVisibility';
import {Parser,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {evaluateCollectionFormula,evaluateFieldExpressionDetailed} from '../../../component-libraries/shared/FieldExpression.js';
import {loadFlowScreenRecordPage} from '../../authentication/Client/authClient';
import {loadBoundedCollectionSource} from './loadBoundedCollectionSource';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import {isCollectionSourceExpression,namedCollectionNames,registerSessionCollection,useSessionCollectionSnapshot} from './pageCollectionSession';
import {formulaCollectionReferenceKey} from '../../../../../server/src/expression-engine/FormulaCollection.js';
import {parseCollectionListBinding,filteredCollectionItems,sessionCollectionFields} from './pageCollectionListBinding';
import {filterPageComponentRecords} from './pageComponentBindings';

type Row=Record<string,unknown>;
export type PageNamedCollection={name:string;key?:string;items:unknown[];columns?:readonly string[];objectApiName?:string};
type SourceResult={key:string;records:Record<string,Row[]>;error?:string};

/** TABLE's first argument is an Object reference, not a scalar field.
 * Parse using the global Formula parser; never infer a source from text fragments.
 */
export function tableFormulaObject(formula:string):string|null{
 try{
  const node=new Parser(tokenize(formula.trim().replace(/^=\s*/,''))).parse();
  const source=node.kind==='call'&&node.name==='TABLE'?node.args[0]:null;
  return source?.kind==='reference'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(source.value)
   ?source.value:null;
 }catch{return null;}
}

export function collectionFormulaReferences(formula:string,primaryObject='',knownCollections:readonly string[]=[],primaryFields?:readonly string[]):Array<{object:string;field:string}>{
 if(!/\bCOLLECTION\s*\(/i.test(formula))return [];
 const found=new Map<string,{object:string;field:string}>();
 const visit=(node:Expression):void=>{
  if(node.kind==='reference'){
   const match=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(node.value);
   if(match&&!['state','session','event'].includes(match[1].toLowerCase()))
    found.set(match[0],{object:match[1],field:match[2]});
   else if(primaryObject&&/^[A-Za-z][A-Za-z0-9_]*$/.test(node.value)
     &&!knownCollections.some(name=>name.toLowerCase()===node.value.toLowerCase())
     &&(!primaryFields||primaryFields.includes(node.value)))
     found.set(primaryObject+'.'+node.value,{object:primaryObject,field:node.value});
  }else if(node.kind==='call'){
   node.args.forEach((arg,index)=>{
    if(node.name==='COLLECTION'&&index===0
      &&arg.kind==='reference'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(arg.value))return;
    visit(arg);
   });
  }
  else if(node.kind==='unary')visit(node.value);
  else if(node.kind==='binary'){visit(node.left);visit(node.right);}
 };
 try{visit(new Parser(tokenize(formula.trim().replace(/^=\s*/,''))).parse());}catch{/* evaluator reports syntax errors */}
 return [...found.values()];
}

/** Source queries are standard RBAC-protected Object API reads. Formula evaluation
 * never fetches data, and no incomplete record page is presented as a collection.
 * This hook is reusable by any metadata collection consumer, not Smart Tabs only.
 */
export function usePageCollectionFormula(
 formula:unknown,properties:Readonly<Row>,objects:readonly ObjectMetadata[],
 primaryObject:string,primaryRecords:readonly Row[],primaryTotal:number,
 revision:number,pageState:Readonly<Row>,sessionId:string,pageSessionKey:string,componentId:string
):{collection:PageNamedCollection|null;error:string|null;loading:boolean;
   formulaSources:Readonly<Record<string,readonly Row[]>>;
   namedCollections:Readonly<Record<string,PageNamedCollection>>}{
 const scope=pageSessionKey+'#'+sessionId;
 const registry=useSessionCollectionSnapshot(scope);
 const existingCollections=Object.keys(registry.collections);
 const primaryFields=objects.find(object=>object.apiName===primaryObject)?.fields.map(field=>field.apiName)??[];
 const declared=typeof formula==='string'?formula.trim():'';
 // A Collection is authored in any existing formula property. The old hidden
 // collectionFormula metadata remains readable for previously published pages.
 const expressions=Object.entries(properties).filter(([key,value])=>
   key!=='collectionFormula'&&typeof value==='string').map(([,value])=>String(value).trim());
 const explicit=expressions.find(value=>value.startsWith('=')&&namedCollectionNames(value).length>0)
   ??expressions.find(value=>value.startsWith('=')&&isCollectionSourceExpression(value,existingCollections))
   ??expressions.find(value=>/^=\s*@[A-Za-z][A-Za-z0-9_]{0,79}(?:\.[A-Za-z][A-Za-z0-9_]*)?$/.test(value));
 const reference=expressions.find(value=>/^@[A-Za-z][A-Za-z0-9_]{0,79}(?:\.[A-Za-z][A-Za-z0-9_]*)?$/.test(value));
 const listExpression=expressions.find(value=>Boolean(parseCollectionListBinding(value,primaryObject)));
 const tableExpression=expressions.find(value=>/^=?\s*TABLE\s*\(/i.test(value));
 // List-expression metadata is distinct from scalar Boolean expressions. A
 // source binding selects records; individual row property formulas remain scalar.
 const rawTextSource=typeof properties.textSource==='string'?properties.textSource.trim():'';
 const selectedTableSource=(
  /^=?\s*TABLE\s*\(/i.test(rawTextSource)||
  /^=?\s*@[A-Za-z][A-Za-z0-9_]*$/.test(rawTextSource)
   &&objects.some(object=>('@'+object.apiName).toLowerCase()===rawTextSource.replace(/^=\s*/,'').toLowerCase()))
  ?rawTextSource:null;
 const entered=selectedTableSource||explicit||tableExpression||listExpression||declared||reference||'';
 const source=entered.startsWith('=')?entered.slice(1).trim():entered;
 const directSource=/^@([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/.exec(source);
 const tableObject=tableFormulaObject(source);
 const fullObject=directSource&&!directSource[2]
  ?objects.find(object=>object.apiName.toLowerCase()===directSource[1].toLowerCase())?.apiName??null:null;
 const sourceName=tableObject??fullObject;
 const tableSourceObject=objects.find(object=>object.apiName.toLowerCase()===sourceName?.toLowerCase())?.apiName??sourceName;
 const isTableProjection=Boolean(tableSourceObject);
 const directObject=directSource?.[2]?directSource[1]:primaryObject;
 const directField=directSource?.[2]??directSource?.[1];
 const directMetadata=directObject?objects.find(item=>item.apiName===directObject):undefined;
 // Only a metadata-authorised Object Field can become a record-list source.
 // A bare @name that is not a Field remains eligible as a saved named Collection.
 const directBinding=directField&&directMetadata?.fields.some(item=>item.apiName===directField)
  ?{object:directObject,field:directField,criterion:'*',operator:'='}:null;
 const listBinding=parseCollectionListBinding(source,primaryObject)??directBinding;
 const namedListSource=listBinding&&listBinding.object===primaryObject
  ?Object.entries(registry.collections).find(([key])=>key.toLowerCase()===listBinding.field.toLowerCase())?.[1]:undefined;
 const primaryField=Boolean(listBinding&&objects.find(o=>o.apiName===listBinding.object)
   ?.fields.some(field=>field.apiName===listBinding.field));
 const unresolvedNamedList=Boolean(listBinding&&!namedListSource&&!primaryField
   &&listBinding.object===primaryObject);
 const sourceRefs=unresolvedNamedList||namedListSource?[]:
  listBinding?[{object:listBinding.object,field:listBinding.field}]:
    collectionFormulaReferences(source,primaryObject,existingCollections,primaryFields);
 // Scalar formulas may consume a Collection without themselves returning one.
 const scalarRefs=expressions.filter(value=>/\bCOLLECTION\s*\(/i.test(value))
  .flatMap(value=>collectionFormulaReferences(value,primaryObject,existingCollections,primaryFields));
 const refs=[...new Map([...sourceRefs,...scalarRefs]
  .map(ref=>[ref.object+'.'+ref.field,ref])).values()];
 const referencesNamed=Boolean(namedCollectionNames(source).length);
 // Source slots are metadata properties, not a fixed three-object limit.
 // The same RBAC-protected Object API read is used for every selected source.
 const selected=Object.keys(properties).filter(key=>/^objectApiName(?:[2-9]|[1-9][0-9]+)?$/.test(key))
  .sort((a,b)=>(a==='objectApiName'?1:Number(a.slice(13)))-
    (b==='objectApiName'?1:Number(b.slice(13))))
  .map(key=>String(properties[key]??'')).filter(Boolean);
 const referenced=[...new Set([...refs.map(ref=>ref.object),...(tableSourceObject?[tableSourceObject]:[])])];
 const secondary=referenced.filter(name=>name!==primaryObject);
 // Keep resolved secondary-source rows during background refreshes for this same page session.
 // Changing source, selection or session still hides rows until the new scope is authorised.
 const sourceKey=JSON.stringify([source,selected,secondary,primaryObject,pageSessionKey,sessionId]);
 const key=JSON.stringify([sourceKey,revision]);
 const [remote,setRemote]=useState<SourceResult|null>(null);
 useEffect(()=>{
  let active=true;
  if(!secondary.length){setRemote({key:sourceKey,records:{}});return()=>{active=false;};}
  setRemote(previous=>previous?.key===sourceKey?previous:null);
  void Promise.all(secondary.map(async name=>{
   if(!selected.includes(name)||!objects.some(o=>o.apiName===name))
    throw Error('COLLECTION source Object is not selected: '+name);
   const records=await loadBoundedCollectionSource(name,loadFlowScreenRecordPage);
   return [name,records] as const;
  })).then(results=>{if(active)setRemote({key:sourceKey,records:Object.fromEntries(results)});})
   .catch((error:unknown)=>{if(active)setRemote({key:sourceKey,records:{},
     error:error instanceof Error?error.message:'COLLECTION source failed'});});
  return()=>{active=false;};
 },[key]);
 const result=(()=>{
 if(!source)return {collection:null,error:null,loading:false};
 const saved=/^@([A-Za-z][A-Za-z0-9_]{0,79})$/.exec(source);
 if(saved){
  const named=Object.entries(registry.collections).find(([name])=>name.toLowerCase()===saved[1].toLowerCase())?.[1];
  if(named)return {collection:named,error:null,loading:false};
  if(!directBinding&&!fullObject)return {collection:null,error:null,loading:false};
 }
 if(unresolvedNamedList)return {collection:null,error:null,loading:false};
 if(!listBinding&&!isTableProjection&&!referencesNamed&&!isCollectionSourceExpression(source,existingCollections))
  return {collection:null,error:null,loading:false};
 const notSelected=refs.find(ref=>!selected.includes(ref.object))
  ??(tableSourceObject&&!selected.includes(tableSourceObject)?{object:tableSourceObject}:undefined);
 if(notSelected)return {collection:null,error:'Select Object '+notSelected.object+' in Data Source before referencing it',loading:false};
 const missingField=refs.find(ref=>!objects.find(o=>o.apiName===ref.object)?.fields.some(f=>f.apiName===ref.field));
 if(missingField)return {collection:null,error:'COLLECTION field unavailable: '+missingField.object+'.'+missingField.field,loading:false};
 if(!isTableProjection&&referenced.includes(primaryObject)&&primaryTotal>primaryRecords.length)
  return {collection:null,error:'COLLECTION primary source has more records than are loaded; narrow its filters',loading:false};
 if(secondary.length&&remote?.key!==sourceKey)return {collection:null,error:null,loading:true};
 if(remote?.error)return {collection:null,error:remote.error,loading:false};
 const sources:Record<string,Row[]>={...remote?.records};
 if(primaryObject&&referenced.includes(primaryObject))sources[primaryObject]=[...primaryRecords];
 if(listBinding){
  const rows=namedListSource?namedCollectionRows(namedListSource):sources[listBinding.object]??[];
  const criteria=namedListSource?{...listBinding,field:'Name'}:listBinding;
  return {collection:{name:'__filtered_list__',
    items:filteredCollectionItems(criteria,rows)},error:null,loading:false};
 }
 const resolved=evaluateCollectionFormula(fullObject?'TABLE(@'+fullObject+')':source,sources,{state:pageState,session:{id:sessionId},
   primaryObject,record:primaryRecords.length===1?primaryRecords[0]:{},
   collectionSourceFields:Object.fromEntries(objects.map(object=>[
    object.apiName,object.fields.map(field=>field.apiName)])),
   namedCollections:registry.collections});
 const value=resolved.value as PageNamedCollection|null;
 return {collection:value?{...value,key:formulaCollectionReferenceKey(value.name)}:null,
   error:resolved.error??null,loading:false};
 })();
 // Only a bounded, already-authorised session collection is filtered locally.
 // Object-backed lists always use the existing tenant/RBAC-protected Record API.
 const sessionResult=(()=>{
  if(primaryObject||!result.collection)return result;
  const visual=properties.filterMode!=='Formula'&&Array.isArray(properties.filters)
   ?properties.filters:[];
  const authored=properties.filterMode!=='Field'&&typeof properties.filterFormula==='string'
   ?properties.filterFormula.trim():'';
  if(!visual.length&&!authored)return result;
  const rows=namedCollectionRows(result.collection)
   .map(row=>({...row,Value:row.__collectionValue}));
  const visualRows=visual.length?filterPageComponentRecords(rows,visual,sessionCollectionFields,
   {pageState,sessionId},properties.filterLogic==='OR'?'OR':'AND'):rows;
  let formulaError:string|null=null;
  const kept=authored?visualRows.filter(row=>{
   const outcome=evaluateFieldExpressionDetailed(authored,row,{namedCollections:registry.collections});
   if(outcome.error){formulaError=outcome.error;return false;}
   return outcome.value==='true'||outcome.value===true;
  }):visualRows;
  const positions=new Set(kept.map(row=>(row as Row).__collectionIndex));
  return {...result,collection:{...result.collection,
   items:result.collection.items.filter((_,index)=>positions.has(index))},
   error:formulaError??result.error};
 })();
 const visible=visiblePageCollectionResult(sessionResult);
 // A restricted record presenter may enforce additional channel grants.
 // Its unpresented Object rows must never be published as a shared collection.
 const owned=referencesNamed&&!properties.recordPresenterApiName?visible.collection:null;
 const identity=owned?JSON.stringify(owned):'';
 useEffect(()=>registerSessionCollection(scope,componentId,owned),[scope,componentId,identity]);
 const duplicate=registry.errors[componentId];
 // Scalar formulas such as SUM(COLLECTION(...)) use these very same already
 // authorised complete Object rows; no renderer or formula performs its own IO.
 const complete=(isTableProjection||!primaryObject||primaryTotal<=primaryRecords.length)
  &&(!secondary.length||remote?.key===sourceKey)&&!remote?.error;
 const formulaSources:Record<string,readonly Row[]>=complete?{
  ...(remote?.key===sourceKey?remote.records:{}),
  ...(primaryObject?{[primaryObject]:primaryRecords}:{})
 }:{};
 return {...(duplicate?{collection:null,error:duplicate,loading:false}:visible),
   formulaSources,namedCollections:registry.collections};
}

/** Read-only record-shaped adapter for collection-capable Tables, Lists and Cards.
 * Synthetic manual values have no database ID and cannot masquerade as records.
 */
export function namedCollectionRows(collection:PageNamedCollection):Row[]{
 return collection.items.map((item,index)=>{
  if(item&&typeof item==='object'&&!Array.isArray(item)
    &&'label' in item&&'value' in item){
   const entry=item as {label:unknown;value:unknown;record?:unknown};
   const record=entry.record&&typeof entry.record==='object'&&!Array.isArray(entry.record)
    ?entry.record as Row:{};
   // A collection's criterion label is not the record title. Preserve the
   // authorised source record so Cards and Lists render the actual row fields.
   return {...record,Name:typeof record.Name==='string'&&record.Name.trim()
     ?record.Name:String(entry.label??''),Id:record.Id??record.id??entry.value??'',
     __collectionLabel:String(entry.label??''),__collectionValue:entry.value,
     __collectionCriteriaField:typeof (item as Row).criteriaField==='string'?(item as Row).criteriaField:'',
     __collectionCriteria:typeof (item as Row).criteria==='string'?(item as Row).criteria:'',
     __collectionManual:!entry.record,__collectionIndex:index};
  }
  return {Id:'',Name:item===null||item===undefined?'':String(item),
   __collectionLabel:item===null||item===undefined?'':String(item),
   __collectionValue:item,__collectionManual:true,__collectionIndex:index};
 });
}
