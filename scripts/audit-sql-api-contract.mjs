import fs from 'node:fs';
import path from 'node:path';
const root='apps/web/src';
const serverRoot='apps/server/src/system-support';
const server=fs.readFileSync(path.join(serverRoot,'server.ts'),'utf8');
const dynamic=['ObjectApiController.ts','MetadataApiController.ts','FlowApiController.ts','PageApiController.ts']
 .map(name=>fs.readFileSync(path.join('apps/server/src/api',name),'utf8')).join('\n');
const files=[];
function walk(dir,target){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,target);else if(/\.tsx?$/.test(p))target.push(p);}}
walk(root,files);
const serverFiles=[];
walk(serverRoot,serverFiles);
walk('apps/server/src/api',serverFiles);
const routes=serverFiles.flatMap(file=>{const source=fs.readFileSync(file,'utf8');return [...source.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"]\/api([^'"]+)['"]/g)].map(m=>({method:m[1].toUpperCase(),path:m[2]}));});
for(const file of serverFiles){
 const source=fs.readFileSync(file,'utf8');
 for(const loop of source.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s*\[([^\]]+)\]\s*as const\s*\)\s*\{([\s\S]*?)\n\s*\}/g)){
  const operation=loop[1];
  const values=[...loop[2].matchAll(/['"]([^'"]+)['"]/g)].map(match=>match[1]);
  const route=loop[3].match(new RegExp(`app\\.(get|post|put|patch|delete)\\(\\s*['"]\\/api([^'"]+)['"]\\s*\\+\\s*${operation}`));
  if(route)for(const value of values)routes.push({method:route[1].toUpperCase(),path:route[2]+value});
 }
}
const kinds=['platform-events','email-alerts','approval-processes','dashboards','dashboard-folders','dashboard-territories','reports','report-folders','connector-providers','integration-connections'];
for(const name of kinds)for(const method of ['GET','POST','PUT','DELETE'])routes.push({method,path:(name.startsWith('connector')||name.startsWith('integration')?'':'/metadata')+'/'+name+(method==='PUT'||method==='DELETE'?'/:apiName':'')});
// Required visual Builder contracts are method-sensitive.
const builderRoutes=[
 ['GET','/metadata/apps'],['POST','/metadata/apps'],['PUT','/metadata/apps/:apiName'],
 ['DELETE','/metadata/apps/:apiName'],
 ['GET','/metadata/offline-publication'],
 ['POST','/named-credentials/:id/test'],['POST','/named-credentials/:id/rotate'],
 ['GET','/metadata/pages'],['GET','/metadata/pages/:apiName'],
 ['PUT','/metadata/pages/:apiName'],['DELETE','/metadata/pages/:apiName'],
 ['GET','/metadata/flows'],['GET','/metadata/flows/list'],
 ['GET','/metadata/flows/:apiName'],['PUT','/metadata/flows/:apiName'],
 ['DELETE','/metadata/flows/:apiName'],['POST','/metadata/flows/:apiName/validate']
];
for(const [method,route] of builderRoutes){
 const signature="app."+method.toLowerCase()+"('/api"+route+"'";
 if(!server.includes(signature)&&!dynamic.includes(signature))
  throw new Error('Missing required Builder API contract: '+method+' /api'+route);
}
if(!server.includes("'GET,POST,PUT,PATCH,DELETE,OPTIONS'"))
 throw new Error('Builder PUT methods must be allowed by tenant-scoped CORS preflight');
const calls=[];
for(const file of files){const txt=fs.readFileSync(file,'utf8');for(const m of txt.matchAll(/(?:apiRequest|request)\s*(?:<[^\n]*?>)?\s*\(\s*(['"`])(\/[^'"`\n]+)\1/g)){
 let requestPath=m[2];
 const tail=txt.slice(m.index+m[0].length);
 let remaining=tail;
 for(let part=0;part<8;part++){
  const parameter=remaining.match(/^\s*\+\s*(?:encodeURIComponent\([^)]*\)|[A-Za-z_$][\w$]*)/);
  if(!parameter)break;
  requestPath+=':parameter';
  remaining=remaining.slice(parameter[0].length);
  const literal=remaining.match(/^\s*\+\s*(['"`])([^'"`\n]*)\1/);
  if(!literal)break;
  requestPath+=literal[2];
  remaining=remaining.slice(literal[0].length);
 }
 let depth=0,query=-1;
 for(let i=0;i<requestPath.length;i++){
  if(requestPath[i]==='$'&&requestPath[i+1]==='{'){depth++;i++;continue;}
  if(requestPath[i]==='}'&&depth){depth--;continue;}
  if(requestPath[i]==='?'&&!depth){query=i;break;}
 }
 if(query>=0)requestPath=requestPath.slice(0,query);
 requestPath=requestPath.replace(/\/{2,}/g,'/');
 calls.push({file,path:requestPath});
}}
const matches=(route,target)=>{
 if(target.endsWith('/')&&route.startsWith(target))return true;
 if(route.endsWith('/')&&target.startsWith(route)){
  const prefix=route.slice(0,-1).split('/'),path=target.split('/');
  if(prefix.length<=path.length&&prefix.every((part,i)=>part===path[i]||part.startsWith(':')||path[i].startsWith(':')))return true;
 }
 const a=route.split('/'),b=target.split('/');
 return a.length===b.length&&a.every((p,i)=>p===b[i]||p.startsWith(':')||b[i].startsWith(':')||b[i].includes('${'));
};
const missed=[...new Map(calls.filter(x=>!routes.some(r=>matches(r.path,x.path))).map(x=>[x.path,x])).values()].sort((a,b)=>a.path.localeCompare(b.path));
const baseline=JSON.parse(fs.readFileSync('scripts/sql-api-compatibility-gaps.json','utf8')).unmatchedPaths;
const unexpected=missed.filter(x=>!baseline.includes(x.path));
const stale=baseline.filter(target=>!missed.some(x=>x.path===target));
if(stale.length)console.warn('SQL API compatibility baseline candidates for review:',stale);
if(unexpected.length){
 console.error('New frontend endpoints without matching SQL routes:',unexpected);
 process.exitCode=1;
}
console.log(JSON.stringify({frontendFiles:files.length,staticCalls:calls.length,serverRoutes:routes.length,unmatched:missed},null,2));
