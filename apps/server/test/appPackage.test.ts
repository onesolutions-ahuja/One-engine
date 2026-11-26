import assert from 'node:assert/strict';
import test from 'node:test';
import {appPackageHash,appPackagePages,appPackageText,type AppPackagePage} from '../src/page-compiler/source/appPackage.js';

/** A page source shaped like the generator's output (two pages, each with its own css + code). */
function page(pageApi:string,css:string):AppPackagePage{
 return {
  pageApi,
  page:{apiName:pageApi,label:pageApi,layoutMode:'free-canvas',canvasWidth:1200,canvasHeight:800,
   components:[{id:pageApi+'-1',type:'Custom:smart_button',label:'Pay',
    position:{x:10,y:20,width:120,height:40},properties:{navigatorName:'Pay'}}]},
  plan:{apiName:pageApi,revision:1,components:[],dataSources:[],targetObject:''} as never,
  moduleText:'// module\nexport const plan = {};\nexport function createActions(host) { return {}; }\n'+
   'export function createFormulas(host) { return {}; }\n',
  codeText:'// code\nexport const codeVersion = 2;\nexport const codeIssues = [];\n'+
   'export function createCode(F, O) { return {actions:{},recordSets:[]}; }\n',
  css
 };
}

const two=()=>[page('Till','.c-Pay{background:#111;}\n'),page('SalePop','.c-Total{color:#222;}\n')];

test('the package holds both pages and the styles of both',()=>{
 const built=appPackageText({appApi:'Shop',variant:'Desktop',pages:two()});
 assert.deepEqual(appPackagePages(built.code),['SalePop','Till']);
 assert.match(built.code,/\.c-Pay\{background:#111;\}/);
 assert.match(built.code,/\.c-Total\{color:#222;\}/);
 assert.match(built.code,/window\.__uneAppPackage=/);
 // Both pages carry their wire-up: the plan and the page code factories.
 assert.equal(built.code.split('return {plan:plan,createActions:createActions').length-1,2);
 assert.equal(built.code.split('createCode:createCode').length-1,2);
});

test('nothing from React or the component libraries is inlined',()=>{
 const built=appPackageText({appApi:'Shop',variant:'Desktop',pages:two()});
 assert.doesNotMatch(built.code,/React\.createElement/);
 assert.doesNotMatch(built.code,/from ['"]react['"]/);
 assert.doesNotMatch(built.code,/require\(['"]react['"]\)/);
 assert.doesNotMatch(built.code,/@une\/smart/);
 assert.doesNotMatch(built.code,/@une\/formula-library/);
});

test('the same pages give the same hash, and a changed page a new one',()=>{
 const first=appPackageText({appApi:'Shop',variant:'Desktop',pages:two()});
 const again=appPackageText({appApi:'Shop',variant:'Desktop',pages:two()});
 assert.equal(first.hash,again.hash);
 assert.equal(first.hash.length,32);
 assert.match(first.hash,/^[A-Za-z0-9_-]{32}$/);
 assert.equal(appPackageHash(first.code),first.hash);
 const changed=appPackageText({appApi:'Shop',variant:'Desktop',
  pages:[page('Till','.c-Pay{background:#333;}\n'),page('SalePop','.c-Total{color:#222;}\n')]});
 assert.notEqual(changed.hash,first.hash);
});

test('page order in the input does not change the file',()=>{
 const forward=appPackageText({appApi:'Shop',variant:'Desktop',pages:two()});
 const backward=appPackageText({appApi:'Shop',variant:'Desktop',pages:[...two()].reverse()});
 assert.equal(forward.code,backward.code);
 assert.equal(forward.hash,backward.hash);
});

test('unsafe names are refused instead of written into the file',()=>{
 assert.throws(()=>appPackageText({appApi:'Bad App',variant:'Desktop',pages:[]}),/not file safe/);
 assert.throws(()=>appPackageText({appApi:'Shop',variant:'Desktop',pages:[page('Bad/Page','')]}),/not file safe/);
});

import {resolveAppPackagePages,screenTargets,type AppPackageResolver} from '../src/page-compiler/source/appPackage.js';

/** A database with one app whose only listed page is the till; its popup is reached by SCREEN(). */
const client={query:async(sql:string)=>({rows:/FROM md_apps a/.test(sql)?[{id:'app-1'}]
 :/FROM md_page_definitions p/.test(sql)?[{api_name:'till'}]:[]})};
const screen=(apiName:string,layoutVariant:string,extra:Record<string,unknown>={})=>({apiName,layoutVariant,
 components:[{id:'b',type:'Custom:smart_button',properties:{actionFlows:{click:'=SCREEN("pay_popup", popup)'}}}],...extra});
/** The server rules: the till has Desktop and a Custom layout for windows 1000-2000 px wide;
 * Mobile/Tablet fall back; the popup exists only as an in-screen page. */
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
 // Tablet and Mobile use the Desktop layout (the page route's fallbacks).
 assert.deepEqual(found.routes.app.till,{Desktop:'till.Desktop',Tablet:'till.Desktop',Mobile:'till.Desktop',Custom:'till.Custom'});
 assert.deepEqual(found.routes.inScreen.pay_popup?.Custom,'pay_popup.Custom');
 assert.deepEqual(found.routes.custom.till,{key:'till.Custom',min:1000,max:2000});
 assert.equal(found.routes.app.pay_popup,undefined);
});

test('SCREEN targets are read from the page formulas',()=>{
 assert.deepEqual(screenTargets({components:[{properties:{a:'=IF(x, SCREEN(pay_popup), SCREEN("cash_popup", current, 2))'}}]}),
  ['pay_popup','cash_popup']);
});
