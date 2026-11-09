import type {LightningPageMetadata,ObjectMetadata} from '../../metadata/Definitions/metadata';
import {compilePage,type CompiledPage,type CompileOptions} from '../../../../../server/src/page-compiler/compilePage.js';

/** The page compiler is shared with the server, which builds each saved page's
 * compiled.js. The browser uses the same code for Preview of unsaved edits. */
export * from '../../../../../server/src/page-compiler/compilePage.js';

/** Cache: one compile per page version, shared by Preview, runtime and download. */
const cache=new WeakMap<LightningPageMetadata,{objects:readonly ObjectMetadata[];strict:boolean;compiled:CompiledPage}>();
export function compilePageCached(page:LightningPageMetadata,objects:readonly ObjectMetadata[],options:CompileOptions={}):CompiledPage{
 const hit=cache.get(page);
 if(hit&&hit.objects===objects&&hit.strict===Boolean(options.strictLegacy))return hit.compiled;
 const compiled=compilePage(page,objects,options);
 cache.set(page,{objects,strict:Boolean(options.strictLegacy),compiled});
 return compiled;
}
