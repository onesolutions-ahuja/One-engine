/** A Highlights Panel cannot grant access to any field on its own.
 * Use already authorised record metadata, and retain compact layout fallback.
 */
export function resolveHighlightFields<T extends {apiName:string}>(
 configured:readonly string[]|undefined,
 fallback:readonly T[],
 readable:readonly T[]
):T[]{
 if(!configured?.length)return [...fallback];
 const byName=new Map(readable.map(field=>[field.apiName,field]));
 return [...new Set(configured)].flatMap(name=>byName.has(name)?[byName.get(name)!]:[]);
}
