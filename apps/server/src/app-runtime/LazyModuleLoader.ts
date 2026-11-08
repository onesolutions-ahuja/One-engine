/** Optional modules are loaded only after entitlement and activation checks. */
export async function loadActivatedAppModule<T>(checks:{installed:boolean;entitled:boolean;active:boolean;authorized:boolean},load:()=>Promise<T>):Promise<T>{
 if(!checks.installed||!checks.entitled||!checks.active||!checks.authorized)
  throw new Error('App module is unavailable');
 return load();
}
