import {transform} from 'esbuild';

const cache=new Map<string,string>();

export async function compileTenantComponent(source:string):Promise<string>{
 if(typeof source!=='string'||!source.trim()||source.length>100_000)
  throw Error('Component source is empty or exceeds the size limit');
 if(/^\s*import\b/m.test(source)||/^\s*export\s+(?:\*|\{)/m.test(source)||/\bimport\s*\(/.test(source))
  throw Error('Tenant components cannot import external modules');
 if(!/^\s*export\s+default\b/m.test(source)&&!/\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/m.test(source))
  throw Error('Tenant components must export a default React component');
 const cached=cache.get(source);
 if(cached)return cached;
 const result=await transform(source,{
  loader:'tsx',format:'cjs',target:'es2022',
  jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment'
 });
 if(cache.size>=64)cache.delete(cache.keys().next().value!);
 cache.set(source,result.code);
 return result.code;
}
