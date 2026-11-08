import {assertMasterDetailReparenting} from '../field-engine/types/MasterDetailField.js';
/** Master-detail reparenting policy delegates to the same field validator. */
export function enforceMasterDetailReparenting(previous:string|null|undefined,next:string,key:string,allowReparenting:boolean){
 assertMasterDetailReparenting(previous,next,key,allowReparenting);
}
