import {createHash} from 'node:crypto';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {PageRuntime} from '../system-files/page-runtime.js';
import {PAGE_LAYOUT_VARIANTS} from '../system-files/page-layout-version-runtime.js';

type Component={properties?:Record<string,unknown>};
type EditorPage={components?:Component[];draftRevision?:number;publishedRevision?:number};
export type FieldPlacementResult={page:string;variant:string;status:'added'|'present'|'draft-only'|'skipped';reason?:string};

/** Object-owned Record View/Edit page API names, matching md_ensure_object_record_pages. */
export function objectRecordPageApiNames(tenantId:string,objectApi:string){
 const key=createHash('md5').update(tenantId+':'+objectApi).digest('hex').slice(0,20);
 return ['Record_'+key+'_Edit','Record_'+key+'_View'];
}

/** Append a field to the first Field Section of a Record Page component list.
 * Returns false when there is no Field Section or the field is already placed. */
export function appendFieldToFieldSection(page:EditorPage,fieldApi:string):boolean{
 const section=(page.components??[]).find(component=>Array.isArray(component.properties?.fieldApiNames));
 const names=section?.properties?.fieldApiNames as unknown[]|undefined;
 if(!names||names.includes(fieldApi))return false;
 names.push(fieldApi);
 return true;
}

/**
 * The New Field wizard's "Add to Page Layouts" step. Record forms are rendered from
 * the object's versioned Record Edit/View pages, so a selected layout must place the
 * field there too. Runs after the field exists; never fails field creation.
 * A variant is republished only when it had no pending unpublished draft, so an
 * administrator's in-progress Page Builder work is never published implicitly.
 */
export async function placeNewFieldOnRecordPages(pages:PageRuntime,rbac:RbacEngine,
 tenantId:string,userId:string,objectApi:string,fieldApi:string):Promise<FieldPlacementResult[]>{
 const results:FieldPlacementResult[]=[];
 if(!await rbac.allowed(tenantId,userId,'PageDefinition','manage'))
  return [{page:'*',variant:'*',status:'skipped',reason:'PageDefinition manage permission required'}];
 for(const pageApi of objectRecordPageApiNames(tenantId,objectApi)){
  for(const variant of PAGE_LAYOUT_VARIANTS){
   try{
    const page=await pages.editor(tenantId,pageApi,variant) as EditorPage;
    const pendingDraft=(page.draftRevision??0)!==(page.publishedRevision??0);
    if(!appendFieldToFieldSection(page,fieldApi)){results.push({page:pageApi,variant,status:'present'});continue;}
    const saved=await pages.saveLayoutDraft(tenantId,pageApi,variant,page,userId) as EditorPage;
    if(pendingDraft){results.push({page:pageApi,variant,status:'draft-only'});continue;}
    await pages.publishLayout(tenantId,pageApi,variant,saved.draftRevision,userId);
    results.push({page:pageApi,variant,status:'added'});
   }catch(error){
    results.push({page:pageApi,variant,status:'skipped',reason:error instanceof Error?error.message:String(error)});
   }
  }
 }
 return results;
}
