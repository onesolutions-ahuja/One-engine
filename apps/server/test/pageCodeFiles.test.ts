import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generatePageSource} from '../src/page-compiler/source/generatePageSource.js';
import {serverCodeFromFiles} from '../src/page-compiler/source/serverPageCodeFromFiles.js';
import {buildPageCode} from '../src/page-compiler/code/pageCode.js';
import {compilePage} from '../src/page-compiler/compilePage.js';

const page={apiName:'till',layoutVariant:'Desktop',components:[
 {id:'pay',type:'Custom:smart_button',visible:true,properties:{navigatorName:'Pay',
  actionFlows:{click:{actionType:'Formula',formula:'=ACTIONS(@ThisPage.Note.Value = "x", SCREEN(pay_popup, popup))'}}}}]};
const files=()=>Object.fromEntries(generatePageSource({appApi:'SHOP',pageApi:'till',variant:'Desktop',page:page as never,
 pageCode:buildPageCode(compilePage(page as never,[],{strictLegacy:true}))}).files.map(file=>[file.path,file.content]));
/** The parts of the server `$` these actions use. */
const scope=()=>{
 const calls:string[]=[];
 return {calls,$:{setValue:(name:string,value:unknown)=>calls.push('set '+name+'='+String(value)),
  ui:async(...args:unknown[])=>{calls.push('ui '+args.join(','));},
  screen:async(...args:unknown[])=>{calls.push('screen '+args.join(','));},
  sql:async(text:string,params:unknown[])=>{calls.push('sql '+text+' '+JSON.stringify(params));return [{n:3}];},
  tenantId:'t-1'}};
};

test('the server runs the page\'s own .actions.ts (the same code the device runs)',async()=>{
 const built=await serverCodeFromFiles(files(),'till');
 assert.deepEqual(Object.keys(built.serverCode.actions),['pay:click']);
 assert.equal(built.actions[0].componentId,'pay');
 const run=scope();
 await built.serverCode.actions['pay:click'].run(run.$);
 assert.ok(run.calls.some(call=>call.startsWith('set Note=x')),run.calls.join(' | '));
});

test('a developer\'s edit runs on the server: a helper file and plain SQL in the transaction',async()=>{
 const edited=files();
 edited['helpers.ts']="export const countOpen = async ($: any) => (await $.sql('SELECT count(*) AS n FROM sales WHERE tenant_id = $1', [$.tenantId]))[0].n;\n";
 const helperImport=['import {countOpen} from ',JSON.stringify('./'+'helpers'),';\n'].join('');
 edited['till.actions.ts']=helperImport+edited['till.actions.ts'].replace(/run: async \(\$\) => \{/,
  'run: async ($) => {\n      $.setValue("Count", await countOpen($));');
 const built=await serverCodeFromFiles(edited,'till');
 const run=scope();
 await built.serverCode.actions['pay:click'].run(run.$);
 assert.ok(run.calls.includes('sql SELECT count(*) AS n FROM sales WHERE tenant_id = $1 ["t-1"]'),run.calls.join(' | '));
 assert.ok(run.calls.includes('set Count=3'));
});

test('server page code can only import the page\'s own files and the formula library',async()=>{
 const edited=files();
 edited['till.actions.ts']="import {execSync} from 'node:child_process';\nexport const x = execSync;\n"+edited['till.actions.ts'];
 await assert.rejects(()=>serverCodeFromFiles(edited,'till'),/can import only/);
});

test('the code folder: publish writes pages/ and versions/, a bad edit gets ERRORS.txt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'une-code-'));
 process.env.UNE_PAGE_CODE_ROOT=root;
 const folder=await import('../src/page-compiler/source/pageCodeFolder.js');
 const kept=files();
 // The database rows the folder reads (one version of till, Desktop, app SHOP).
 const db={query:async(sql:string)=>({rows:/FROM md_tenants WHERE id/.test(sql)?[{slug:'acme'}]
  :/FROM md_tenants WHERE slug/.test(sql)?[{id:'t-1'}]
  :/SELECT layout_variant,version,app_api FROM md_page_code_versions/.test(sql)?[{layout_variant:'Desktop',version:4,app_api:'SHOP'}]
  :/SELECT path,content FROM md_page_code_version_files/.test(sql)?Object.entries(kept).map(([path,content])=>({path,content}))
  :[]})} as never;
 await folder.mirrorPageToFolder(db,'t-1','till');
 const current=join(root,'acme','SHOP','pages','till','Desktop');
 assert.deepEqual((await readdir(current)).sort(),['.une-version',...Object.keys(kept)].sort());
 assert.equal(await readFile(join(current,'till.css'),'utf8'),kept['till.css']);
 assert.ok((await readdir(join(root,'acme','SHOP','versions','till','Desktop'))).includes('v4'));
 // An edit the server cannot accept (this database has no code version to edit): ERRORS.txt, app untouched.
 await writeFile(join(current,'till.css'),kept['till.css']+'\n/* edit */\n','utf8');
 await folder.startPageCodeFolder(db,{rebuildAppPackage:async()=>null} as never);
 await new Promise(resolve=>setTimeout(resolve,2500));
 assert.match(await readFile(join(current,'ERRORS.txt'),'utf8'),/keeps running the last good version/);
 delete process.env.UNE_PAGE_CODE_ROOT;
});
