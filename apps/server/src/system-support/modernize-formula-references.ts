/**
 * One-time rewrite of saved page formulas into the one reference style:
 *   $state.x        -> @ThisPage.<component that saves x>.x  (@ThisPage.Input.x if none)
 *   @state.x := …   -> @ThisPage.<Owner>.x := …
 *   $component.A.b  -> @ThisPage.A.b
 *   @Tabs.state.Id  -> @ThisPage.Tabs.Selected.Id
 *   $session(.id)   -> @ThisPage.Session.Id        $session.cartId -> @ThisTenant.User.CartId
 *   $session.user.* -> @ThisTenant.User.*          $session.tenant.* / $tenant.* -> @ThisTenant.Company.*
 *   $flow.X         -> FLOW(X)                     TABLE(@P, Name) -> TABLE(@P, @P.Name)
 *
 * Covers every page layout version, Lightning page and page component of every
 * tenant. Idempotent: running it twice changes nothing more. Quoted text is
 * never changed. Not run on boot: run it once after deploy with
 *   npm run --workspace apps/server formula:modernize -- --dry-run   (report only)
 *   npm run --workspace apps/server formula:modernize                (write)
 * then republish pages so their converted page code is rebuilt.
 */
import type {SqlExecutor} from '../system-files/sql-persistence.js';
import {decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';
import {modernizeFormula} from '../expression-engine/PageReferences.js';
import {pageValueOwners} from '../expression-engine/PageValueOwners.js';

type Row=MetadataValueRow&{component_key:string;component_type:string;group_key:string};
type Change={table:string;group:string;component:string;path:string;before:string;after:string};
type Source={table:string;rows:string;update:string};

// Each source lists string properties (+ node type) grouped by page/version.
const SOURCES:Source[]=[
 {table:'md_page_layout_version_properties',
  rows:`SELECT p.tenant_id||'|'||p.page_id||'|'||p.variant||'|'||p.version AS group_key,
    p.component_key,n.component_type,p.property_path,p.value_kind,p.value_text
   FROM md_page_layout_version_properties p
   JOIN md_page_layout_version_nodes n USING(tenant_id,page_id,variant,version,component_key)
   ORDER BY group_key,n.sort_order,p.property_path`,
  update:`UPDATE md_page_layout_version_properties SET value_text=$2
   WHERE tenant_id||'|'||page_id||'|'||variant||'|'||version=$1 AND component_key=$3 AND property_path=$4 AND value_text=$5`},
 {table:'md_lightning_page_node_properties',
  rows:`SELECT p.tenant_id||'|'||p.page_id AS group_key,p.component_key,n.component_type,
    p.property_path,p.value_kind,p.value_text
   FROM md_lightning_page_node_properties p
   JOIN md_lightning_page_nodes n USING(tenant_id,page_id,component_key)
   ORDER BY group_key,n.sort_order,p.property_path`,
  update:`UPDATE md_lightning_page_node_properties SET value_text=$2
   WHERE tenant_id||'|'||page_id=$1 AND component_key=$3 AND property_path=$4 AND value_text=$5`}
];
const OLD=/\$(?:state|session|component|tenant|flow)\b|@[A-Za-z][A-Za-z0-9_]*\.state\.[A-Za-z]|@(?:state|session)\.[A-Za-z]|\bTABLE\s*\(/;

/** Pure part (tested): rewrite one page's rows. */
export function modernizePageRows(rows:readonly Row[]):Array<Omit<Change,'table'|'group'>>{
 const byComponent=new Map<string,Row[]>();
 for(const row of rows){
  const list=byComponent.get(row.component_key)??[];
  list.push(row);byComponent.set(row.component_key,list);
 }
 const components=[...byComponent].map(([id,list])=>({id,type:list[0].component_type,
  properties:(decodeMetadataValues(list).props??{}) as Record<string,unknown>}));
 const owners=pageValueOwners(components);
 const changes:Array<Omit<Change,'table'|'group'>>=[];
 for(const row of rows){
  if(row.value_kind!=='string'||typeof row.value_text!=='string'||!OLD.test(row.value_text))continue;
  const next=modernizeFormula(row.value_text,key=>owners.get(key));
  if(next!==row.value_text)changes.push({component:row.component_key,path:row.property_path,
   before:row.value_text,after:next});
 }
 return changes;
}

export async function modernizeFormulaReferences(db:Pick<SqlExecutor,'query'>,options:{dryRun?:boolean}={}):Promise<Change[]>{
 const all:Change[]=[];
 for(const source of SOURCES){
  const result=await db.query<Row>(source.rows);
  const groups=new Map<string,Row[]>();
  for(const row of result.rows){
   const list=groups.get(row.group_key)??[];
   list.push(row);groups.set(row.group_key,list);
  }
  for(const [group,rows] of groups)
   for(const change of modernizePageRows(rows)){
    all.push({table:source.table,group,...change});
    if(!options.dryRun)await db.query(source.update,[group,change.after,change.component,change.path,change.before]);
   }
 }
 return all;
}
