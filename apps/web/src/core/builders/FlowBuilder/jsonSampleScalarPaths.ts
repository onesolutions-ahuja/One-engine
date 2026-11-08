/** Bounded scalar field discovery from a provider's example payload.
 * The example stays in the editor only; no sample data or credentials are published. */
export function jsonSampleScalarPaths(raw:string):string[] {
 if(!raw.trim())return [];
 if(raw.length>262144)throw new Error('Example payload is too large');
 let value:unknown;
 try{value=JSON.parse(raw);}catch{throw new Error('Example must be valid JSON');}
 const paths:string[]=[];
 const walk=(item:unknown,path:string,depth:number):void=>{
  if(paths.length>=150||depth>10)return;
  if(item===null||typeof item==='string'||typeof item==='number'||typeof item==='boolean'){
   if(path)paths.push(path);
   return;
  }
  if(Array.isArray(item)){
   item.slice(0,5).forEach((entry,index)=>walk(entry,path+'['+index+']',depth+1));
   return;
  }
  if(item&&typeof item==='object'){
   for(const [key,entry] of Object.entries(item)){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)||['constructor','prototype','__proto__'].includes(key))continue;
    walk(entry,path?path+'.'+key:key,depth+1);
    if(paths.length>=150)break;
   }
  }
 };
 walk(value,'',0);
 return paths;
}
