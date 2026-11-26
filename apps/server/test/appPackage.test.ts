import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {bundleAppPackage,resolveAppPackagePages,screenTargets,type AppPackageResolver,type PackageScreen} from '../src/page-compiler/source/appPackage.js';
import {generatePageSource} from '../src/page-compiler/source/generatePageSource.js';
import {readPageSource,pageDifferences} from '../src/page-compiler/source/readPageSource.js';
import {screenFromCode} from '../src/page-compiler/source/pageSourceShape.js';
import {buildPageCode} from '../src/page-compiler/code/pageCode.js';
import {compilePage} from '../src/page-compiler/compilePage.js';
import {F,O} from '../src/page-compiler/code/formulaLibrary.js';

/** A database with one app whose only listed page is the till; its popup is reached by SCREEN(). */
const client={query:async(sql:string)=>({rows:/FROM md_apps a/.test(sql)?[{id:'app-1'}]
 :/FROM md_page_definitions p/.test(sql)?[{api_name:'till'}]:[]})};
const screen=(apiName:string,layoutVariant:string,extra:Record<string,unknown>={})=>({apiName,layoutVariant,
 components:[{id:'b',type:'Custom:smart_button',properties:{actionFlows:{click:'=SCREEN("pay_popup", popup)'}}}],...extra});
const resolver:AppPackageResolver={
 appPage:async(page,device,strict)=>page!=='till'?null
  :device==='Custom'?screen('till','Custom',{customTargetEnabled:true,customTargetMinWidth:1000,customTargetMaxWidth:2000})
  :strict?null:device==='Desktop'?screen('till','Desktop'):null,
 inScreenPage:async(page,device)=>page==='pay_popup'?{apiName:'pay_popup',layoutVariant:device==='Custom'?'Custom':'Desktop',components:[]}:null
};

test('every layout is resolved by the server rules, popups are found through SCREEN()',async()=>{
 const found=await resolveAppPackagePages(client,{tenantId:'t',appApi:'Shop',resolver});
 assert.ok(found);
 assert.deepEqual([...found.pages.keys()].sort(),['pay_popup.Custom','pay_popup.Desktop','till.Custom','till.Desktop']);
 assert.deepEqual(found.routes.app.till,{Desktop:'till.Desktop',Tablet:'till.Desktop',Mobile:'till.Desktop',Custom:'till.Custom'});
 assert.deepEqual(found.routes.inScreen.pay_popup?.Custom,'pay_popup.Custom');
 assert.deepEqual(found.routes.custom.till,{key:'till.Custom',min:1000,max:2000});
 assert.equal(found.routes.app.pay_popup,undefined);
});

test('SCREEN targets are read from the page formulas',()=>{
 assert.deepEqual(screenTargets({components:[{properties:{a:'=IF(x, SCREEN(pay_popup), SCREEN("cash_popup", current, 2))'}}]}),
  ['pay_popup','cash_popup']);
});

/** The device runs the code files: build the package, run it, and draw nothing but the code. */
const page={apiName:'till',label:'Till',layoutMode:'free-canvas',canvasWidth:1024,canvasHeight:768,layoutVariant:'Desktop',
 components:[
  {id:'pay',type:'Custom:smart_button',label:'Pay',visible:true,position:{x:10,y:20,width:120,height:40},
   properties:{navigatorName:'Pay',backgroundColor:'#34c759',caption:'=IF(1=1,"Pay","No")',
    actionFlows:{click:{actionType:'Formula',formula:'=ACTIONS(@ThisPage.Note.Value = "x", SCREEN(pay_popup, popup))'}}}},
  {id:'note',type:'Custom:smart_text',label:'Note',visible:false,properties:{navigatorName:'Note',text:'hi'}}]};
async function built(edit?:(files:Record<string,string>)=>void){
 const pageCode=buildPageCode(compilePage(page as never,[],{strictLegacy:true}));
 const files=Object.fromEntries(generatePageSource({appApi:'SHOP',pageApi:'till',variant:'Desktop',page:page as never,pageCode})
  .files.map(file=>[file.path,file.content]));
 edit?.(files);
 const read=readPageSource(files,'till');
 const one:PackageScreen={key:'till.Desktop',pageApi:'till',variant:'Desktop',version:1,files,page:read.page as never,
  plan:compilePage(read.page as never,[],{strictLegacy:true}),issues:read.issues};
 const code=await bundleAppPackage('SHOP',[one],{app:{till:{Desktop:'till.Desktop'}},inScreen:{},custom:{}});
 const Smart=()=>null;
 const react={createElement:(type:unknown,props:Record<string,unknown>|null,...children:unknown[])=>
  ({type,props:{...(props??{}),...(children.length?{children:children.length===1?children[0]:children}:{})}}),Fragment:'frag'};
 // '@une/ui' as the device gives it: one component per tag, carrying its tag.
 const tags=new Map<string,unknown>();
 const tag=(name:string)=>tags.get(name)??tags.set(name,Object.assign(()=>null,{uneTag:name})).get(name);
 const window:Record<string,any>={__une:{modules:{react,'@une/smart':{Smart},'@une/ui':{tag},'@une/formula-library':{F,O}}}};
 vm.runInNewContext(code,{window});
 return {code,file:window.__uneAppPackage,Smart};
}

test('the package is the page code: running it gives the page back, with runnable formulas and actions',async()=>{
 const {code,file,Smart}=await built();
 assert.doesNotMatch(code,/createFormulas|createActions|createCode/);
 assert.equal(file.version,3);
 const device=screenFromCode(file.screens['till.Desktop'],Smart);
 assert.deepEqual(device.issues,[]);
 assert.deepEqual(pageDifferences(page as never,device.page),[]);
 assert.equal(typeof device.code.formulas['pay:caption'],'function');
 assert.equal(device.code.sources['pay:caption'],'=IF(1=1,"Pay","No")');
 assert.equal(typeof device.code.actions['pay:click'].run,'function');
});

test('a developer edit in the code is what the device runs; republishing the same page gives the same file',async()=>{
 const first=await built(),again=await built();
 assert.equal(first.code,again.code);
 const edited=await built(files=>{files['till.css']=files['till.css'].replace('background: #34c759','background: #ff3b30');});
 const device=screenFromCode(edited.file.screens['till.Desktop'],edited.Smart);
 assert.equal(device.page.components[0].properties!.backgroundColor,'#ff3b30');
 assert.notEqual(edited.code,first.code);
});

test('only the page\'s own files and the platform modules can be imported',async()=>{
 await assert.rejects(()=>built(files=>{files['till.tsx']="import fs from 'node:fs';\nexport const leak = fs;\n"+files['till.tsx'];}),/can be imported/);
});
