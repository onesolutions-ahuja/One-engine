import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishedAppIdFromPath,readAppRuntimeMetadata,cachedAppRuntimeMetadata,rememberAppRuntimeMetadata,
 pageCanvasOf,appRuntimeCacheKey} from '../src/core/workspace/AppShell/appRuntimeMetadata.ts';
import {rememberBootAppRuntime,takeBootAppRuntime} from '../src/core/workspace/AppShell/bootAppRuntime.ts';

const src=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src');
const read=(file:string)=>readFileSync(path.join(src,file),'utf8');
const user={id:'u1',profileId:'p1',permissions:[],fieldAccess:{},recordTypeAccess:{}};
const sample=(appId='SMARTTILL')=>({appId,objects:[{apiName:'Product'}],apps:[{apiName:appId}],user,
 pages:[{apiName:'smart_till_billing',pageType:'App Page',status:'Active',canvasWidth:1366,canvasHeight:1024,standalonePresentation:true},
  {apiName:'payment_popup',pageType:'In-Screen Page',status:'Active',canvasWidth:600,canvasHeight:400}]});

test('only published app page addresses open in the app shell',()=>{
 assert.equal(publishedAppIdFromPath('/une/apps/SMARTTILL/pages/smart_till_billing'),'SMARTTILL');
 assert.equal(publishedAppIdFromPath('/une/apps/Kiosk/home'),'Kiosk');
 assert.equal(publishedAppIdFromPath('/une/apps/Kiosk/home/'),'Kiosk');
 for(const other of ['/une/setup/home','/une/o/Product/list','/une/r/Product/1/view','/une/apps/X/routes/y',
  '/display','/login','/une/apps/X/pages/a/b','/une/apps/1bad/home'])
  assert.equal(publishedAppIdFromPath(other),undefined,other);
});

test('runtime metadata is accepted only for the same app and gets empty component lists',()=>{
 const data=readAppRuntimeMetadata(sample(),'SMARTTILL');
 assert.ok(data);
 assert.deepEqual(data.pages.map(page=>page.components),[[],[]]);
 assert.equal(readAppRuntimeMetadata(sample(),'OTHER'),undefined);
 assert.equal(readAppRuntimeMetadata({...sample(),user:undefined},'SMARTTILL'),undefined);
 assert.equal(readAppRuntimeMetadata(null,'SMARTTILL'),undefined);
});

test('the sign-in refresh answer is used once, for its own app',()=>{
 rememberBootAppRuntime(sample());
 assert.equal(takeBootAppRuntime('OTHER'),undefined);
 assert.equal(takeBootAppRuntime('SMARTTILL')?.appId,'SMARTTILL');
 assert.equal(takeBootAppRuntime('SMARTTILL'),undefined);
});

test('the browser copy belongs to one user and one app',()=>{
 const store=new Map<string,string>();
 const storage={getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);},
  removeItem:(key:string)=>{store.delete(key);}};
 rememberAppRuntimeMetadata(storage,'u1',readAppRuntimeMetadata(sample(),'SMARTTILL')!);
 assert.ok(store.has(appRuntimeCacheKey));
 assert.equal(cachedAppRuntimeMetadata(storage,'u1','SMARTTILL')?.objects.length,1);
 assert.equal(cachedAppRuntimeMetadata(storage,'u2','SMARTTILL'),undefined);
 assert.equal(cachedAppRuntimeMetadata(storage,'u1','OTHER'),undefined);
 assert.equal(cachedAppRuntimeMetadata(storage,undefined,'SMARTTILL'),undefined);
 // Sign-out removes it with the landing copy.
 assert.match(read('core/authentication/Client/authClient.ts'),/removeItem\('une\.appRuntime\.v1'\)/);
});

test('popups are sized from the page summaries',()=>{
 const pages=readAppRuntimeMetadata(sample(),'SMARTTILL')!.pages;
 assert.deepEqual(pageCanvasOf(pages,'payment_popup'),{canvasWidth:600,canvasHeight:400});
 assert.deepEqual(pageCanvasOf(pages,'Payment_Popup'),{canvasWidth:600,canvasHeight:400});
 assert.equal(pageCanvasOf(pages,'missing'),undefined);
});

/** Every module the app shell loads up front (static imports only; import() loads on demand). */
function staticClosure(entry:string):Set<string>{
 const seen=new Set<string>();
 const visit=(file:string)=>{
  if(seen.has(file))return;seen.add(file);
  const text=readFileSync(file,'utf8');
  for(const match of text.matchAll(/^\s*import\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm)){
   const base=path.resolve(path.dirname(file),match[1]);
   const candidates=[base,base.replace(/\.js$/,'.ts'),base+'.ts',base+'.tsx',base+'.js',base+'.jsx',base+'.mjs',path.join(base,'index.ts')];
   const found=candidates.find(item=>existsSync(item)&&!item.endsWith('.css')&&/\.(tsx?|jsx?|mjs)$/.test(item));
   if(found)visit(found);
  }
 };
 visit(entry);
 return seen;
}

test('the app shell does not load the Setup shell or the landing bootstrap',()=>{
 const closure=[...staticClosure(path.join(src,'core/workspace/AppShell/AppPageShell.tsx'))];
 const setup=closure.filter(file=>/SetupShell|builders[\\/]|settings[\\/]|setupAppShell/.test(file));
 assert.deepEqual(setup,[],'Setup modules in the app shell: '+setup.join(', '));
 const shell=read('core/workspace/AppShell/AppPageShell.tsx');
 assert.doesNotMatch(shell,/landing-bootstrap|prefetchLandingBootstrap|cachedLanding/);
 assert.match(shell,/\/runtime-metadata/);
});

test('App opens published app pages in the app shell and leaves it for anything else',()=>{
 const app=read('core/workspace/App/App.tsx');
 assert.match(app,/const LazyAppPageShell = React\.lazy\(\(\) => import\('\.\.\/AppShell\/AppPageShell'\)\)/);
 assert.match(app,/useState\(\(\)=>standaloneEntry!==null\|\|!publishedAppIdFromPath\(entryPath\)\)/);
 assert.match(app,/fullWorkspace\?<SetupApp/);
 // The refresh carries the app's runtime metadata; the Setup bootstrap is not requested.
 assert.match(app,/refreshQuery\.set\('app', bootApp\)/);
 assert.match(app,/if \(!session\.landing && !bootApp\) prefetchLandingBootstrap\(\)/);
 assert.match(app,/rememberBootAppRuntime\(session\.appRuntime\)/);
 const shell=read('core/workspace/AppShell/AppPageShell.tsx');
 assert.match(shell,/if \(!appRoute\) onLeave\(\)/);
 assert.match(shell,/keepScreenParams\(appRoutePath\(route\), window\.location\.search\)/);
 assert.match(shell,/<WorkspaceFormulaScreen/);
});

test('server: runtime metadata route and refresh option use the same permissions as the bootstrap',()=>{
 const server=readFileSync(path.resolve(src,'../../server/src/system-support/server.ts'),'utf8');
 assert.match(server,/app\.get\('\/api\/apps\/:appId\/runtime-metadata'/);
 assert.match(server,/await rbac\.require\(tenantId,userId,'App:'\+appId,'read'\)/);
 assert.match(server,/rbac\.allowed\(tenantId,userId,'ObjectDefinition','read'\)/);
 assert.match(server,/rbac\.allowed\(tenantId,userId,'PageDefinition','read'\)/);
 assert.match(server,/appRuntimeMetadata\(session\.tenant_id,session\.user_id,req\.query\.app\)/);
 assert.match(server,/components:\[\],\s*standalonePresentation:/);
});
