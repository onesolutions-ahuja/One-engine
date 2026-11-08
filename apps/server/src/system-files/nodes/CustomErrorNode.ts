import {createFlowCustomError} from '../flow-error-runtime.js';
/** Preserve the shared Flow error contract and resource interpolation. */
export function executeCustomErrorNode(config:Record<string,unknown>,resolveResource:(reference:string)=>unknown):never{
 throw createFlowCustomError(config,resolveResource);
}
