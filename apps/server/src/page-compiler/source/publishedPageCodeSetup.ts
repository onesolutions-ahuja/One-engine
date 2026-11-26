
import type {ObjectDefinitionService} from '../../system-files/object-definition.js';
import {compilePage,type CompilerObject,type CompilerPage} from '../compilePage.js';
import {buildPageCode,pageCodeModule} from '../code/pageCode.js';
import {setPublishedCodeBuilder} from './publishedPageCode.js';

/** Registers the existing page converter (the same one the page script uses) for publish-to-code.
 * Called once from registerPageScriptRoutes. Nothing is cached, so the page script cache is untouched. */
export function registerPublishedCodeBuilder(definitions:Pick<ObjectDefinitionService,'list'>):void{
 setPublishedCodeBuilder(async(tenantId,page)=>{
  const objects=await definitions.list(tenantId) as unknown as CompilerObject[];
  const pageCode=buildPageCode(compilePage(page as CompilerPage,objects,{strictLegacy:true}));
  return {pageCode,moduleText:pageCodeModule(pageCode)};
 });
}
