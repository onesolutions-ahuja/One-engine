import {Parser,type Expression} from '../expression-engine/FormulaParser.js';
import {tokenize} from '../expression-engine/FormulaTokenizer.js';
import {isActionPlan} from '../expression-engine/ActionFormulas.js';

/**
 * Pure page-metadata helpers shared by the browser runtime and the server-side
 * page compiler (the server builds each page's compiled.js from saved metadata).
 * No browser APIs, no React: safe to import on both sides.
 */
export type ActionFormulaAssignment={kind:'state'|'filter'|'navigate';key:string;value:string};

/** Page-state keys a component reads without naming them in its properties:
 * active record scoping uses <field>Id, active<Name>Id and current<Name>Id. */
export function implicitPageStateKeys(
 fields:ReadonlyArray<{apiName:string;relationship?:{targetObject?:string}|null}>
):string[]{
 const keys:string[]=[];
 for(const field of fields){
  if(!field.relationship)continue;
  for(const name of [field.apiName,field.relationship.targetObject]){
   if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))continue;
   keys.push(name.charAt(0).toLowerCase()+name.slice(1)+'Id','active'+name+'Id','current'+name+'Id');
  }
 }
 return keys;
}

/** Inspect metadata formulas (not selector lists) for actual Object reads.
 * Unparseable expressions return null: a conservative invalidate-all fallback.
 */
export function pageComponentReadObjectNames(
 primaryObject:string,properties:Readonly<Record<string,unknown>>,
 knownObjects:readonly {apiName:string;fields?:readonly {apiName:string;dataType?:string}[]}[]
):string[]|null{
 const known=new Set(knownObjects.map(object=>object.apiName));
 const selected=new Set(Object.entries(properties).filter(([key])=>
  /^objectApiName(?:[2-9]|[1-9][0-9]+)?$/.test(key))
  .map(([,value])=>String(value??'')).filter(name=>known.has(name)));
 const reads=new Set<string>();
 if(primaryObject)reads.add(primaryObject);
 for(const [property,value] of Object.entries(properties)){
  if(typeof value!=='string'||/^objectApiName/.test(property))continue;
  const expression=value.trim();
  if(!expression||(!expression.startsWith('=')&&!expression.startsWith('@')
    &&!/(?:TABLE|COLLECTION)\s*\(/i.test(expression)))continue;
  // A click/change Action Formula (ACTIONS, CREATERECORD, UPDATERECORD, ...) runs only when the
  // user acts; it is not data this component DISPLAYS. Counting it made a Product grid look like
  // a reader of CartLine/Cart, so every add-to-cart reloaded the whole catalogue.
  if(isActionPlan(expression))continue;
  let node:Expression;
  try{node=new Parser(tokenize(expression.replace(/^=\s*/,''))).parse();}
  catch{return null;}
  const visit=(ast:Expression):void=>{
   if(ast.kind==='reference'){
    const parts=ast.value.replace(/^@/,'').split('.');
    const first=parts[0];
    if(known.has(first)&&(first===primaryObject||selected.has(first)))reads.add(first);
    const field=knownObjects.find(object=>object.apiName===primaryObject)
     ?.fields?.find(item=>item.apiName===first);
    const lookup=field?.dataType?.match(/^Lookup\(([^)]+)\)$/i)?.[1];
    if(parts.length>1&&lookup&&known.has(lookup))reads.add(lookup);
   }else if(ast.kind==='call'){
    // Aggregate reads are dependencies even when the Object was not selected as
    // a component's primary/secondary record source. A CartLine write must
    // refresh =COUNTIFS(CartLine, ...) and =SUMIFS(CartLine, ...).
    if(['COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS'].includes(ast.name)){
     const source=ast.args[0];
     if(source&&(source.kind==='reference'||source.kind==='literal')
       &&typeof source.value==='string'&&known.has(source.value))
      reads.add(source.value);
    }
    if((ast.name==='TABLE'||ast.name==='COLLECTION')&&ast.args[0]?.kind==='reference'){
     const name=ast.args[0].value.replace(/^@/,'').split('.')[0];
     // Conservative: a missed read leaves stale data, an extra read only costs a refresh.
     if(known.has(name))reads.add(name);
    }
    ast.args.forEach(visit);
   }else if(ast.kind==='unary')visit(ast.value);
   else if(ast.kind==='binary'){visit(ast.left);visit(ast.right);}
  };
  visit(node);
 }
 return [...reads];
}

/**
 * The Page Builder supplies event bindings to the existing platform Flow/Action
 * runtime. A component need not select an Object merely to emit an action.
 * Never execute user-supplied expressions or attach business logic to JSX.
 */
export function needsMetadataComponentRuntime(properties: Record<string, unknown>): boolean {
  // Any registered component can bind to an Object, not just a named business
  // vertical. Keep legacy *ObjectApiName properties working without per-app code.
  if (Object.entries(properties).some(([key, value]) =>
    /objectApiName$/i.test(key) && typeof value === 'string' && value.trim().length > 0)) return true;
  // Explicit record-field bindings also need the data runtime even while the
  // Object binding is missing, so the editor exposes a configuration error
  // instead of silently rendering an empty static grid.
  if (Object.entries(properties).some(([key, value]) =>
    /(?:name|title|price|image|category|vatApplicable|ageRestricted)FieldApiName$/i.test(key) &&
    typeof value === 'string' && value.trim().length > 0)) return true;
  // Field mentions require the same permission-gated data runtime as Object bindings.
  if (Object.values(properties).some(value => typeof value === 'string'
    && /(^|[^A-Za-z0-9_@])@[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/.test(value))) return true;
  // Flow outputs may bind to sibling components without each component querying an Object.
  // These instances must still enter the metadata-aware runtime to receive page state.
  const state = properties.stateBindings;
  if(state && typeof state==='object' && !Array.isArray(state)
     && Object.keys(state).length>0)return true;
  if(properties.filterMode!=='Field'&&typeof properties.filterFormula==='string'&&properties.filterFormula.trim())return true;
  if(typeof properties.collectionFormula==='string'&&properties.collectionFormula.trim())return true;
  const bindings = properties.actionFlows;
  return Boolean(bindings && typeof bindings === 'object' && !Array.isArray(bindings)
    && Object.keys(bindings).length > 0);
}

/** An explicit editor mode determines which saved rules are active.
 * Legacy pages without a mode retain their existing combined semantics. */
export function activePageRecordFilters(properties:Readonly<Record<string,unknown>>):{filters:unknown;formula:unknown}{
 if(properties.filterMode==='Formula')return {filters:[],formula:properties.filterFormula};
 if(properties.filterMode==='Field')return {filters:properties.filters,formula:undefined};
 return {filters:properties.filters,formula:properties.filterFormula};
}

export function parseActionFormulaAssignment(formula:string):ActionFormulaAssignment|null{
 const parts=/^@(state|filter|navigate)\.([A-Za-z][A-Za-z0-9_]{0,63})\s*:=\s*([\s\S]+)$/.exec(formula.trim());
 if(!parts)return null;
 if(formula.length>300||!parts[3].trim())throw Error('Invalid action assignment formula.');
 if(parts[1]==='navigate'&&!['page','list','home'].includes(parts[2]))
  throw Error('Navigation targets are page, list or home.');
 return {kind:parts[1] as ActionFormulaAssignment['kind'],key:parts[2],value:parts[3].trim()};
}
