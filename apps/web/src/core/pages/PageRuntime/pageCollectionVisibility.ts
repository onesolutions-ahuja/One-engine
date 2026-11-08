/** Never report stale collection contents as a successful calculation.
 * Pure presentation check: no Record API imports or tenant-dependent state.
 */
export function visiblePageCollectionResult<T extends {
 collection:{name:string;items:unknown[]}|null;error:string|null;loading:boolean
}>(result:T):T{
 return result.error?{...result,collection:null,loading:false}:result;
}