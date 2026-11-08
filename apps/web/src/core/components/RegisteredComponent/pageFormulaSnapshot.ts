/** Exact shallow scalar comparison for published component bindings.
 * No record payloads or tenant data are cached outside the owning React scope.
 */
export function sameFormulaSnapshot(
 previous:Readonly<Record<string,string|number|boolean>>|undefined,
 next:Readonly<Record<string,string|number|boolean>>
):boolean{
 if(!previous)return false;
 const keys=Object.keys(previous);
 const nextKeys=Object.keys(next);
 return keys.length===nextKeys.length&&
  keys.every(key=>Object.prototype.hasOwnProperty.call(next,key)&&Object.is(previous[key],next[key]));
}
