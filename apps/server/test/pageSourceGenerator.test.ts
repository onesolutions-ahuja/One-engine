import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generatePageSource} from '../src/page-compiler/source/generatePageSource.js';
import {versionsToDelete} from '../src/page-compiler/source/pageCodeVersionStore.js';
import type {PageCode} from '../src/page-compiler/code/pageCode.js';

// esbuild is linked per CLAUDE.md -> Checks (/opt/npm-tools/node_modules/esbuild).
const require=createRequire(import.meta.url);
const {transformSync}=require('esbuild') as {transformSync:(code:string,options:{loader:string})=>unknown};

const components=[
 {id:'c1',type:'Custom:smart_container',label:'Box',visible:true,position:{x:10,y:20,width:300,height:200},
  properties:{navigatorName:'Box',backgroundColor:'#ffffff',radius:8,shadow:'medium'}},
 {id:'c2',type:'Custom:smart_button',label:'Pay',visible:true,position:{x:15,y:25,width:100,height:40},
  properties:{navigatorName:'PayButton',layoutParentId:'c1',labelColor:'#112233',textSize:14,
   actionFlows:{click:{kind:'Formula'}}}},
 {id:'c3',type:'Custom:smart_text',label:'Total',visible:true,position:{x:5,y:80,width:120,height:30},
  properties:{navigatorName:'TotalText',layoutParentId:'c1',text:'=SUM(1,2)',headerBold:true,borderColor:'#cccccc'}},
 {id:'c4',type:'Custom:smart_text',label:'Bad',visible:false,position:{x:0,y:0,width:10,height:10},
  properties:{navigatorName:'BadText',text:'=UNKNOWN()'}}
];
const pageCode:PageCode={version:2,
 formulas:[{key:'c3:text',componentId:'c3',property:'text',source:'=SUM(1,2)',objectApiName:'',js:'(row, $) => 3'}],
 actions:[{key:'c2:click',componentId:'c2',event:'click',objectApiName:'',js:'async ($) => {\n  await $.ui("INFO", "ok", "", "", "", "");\n}',
  data:false,reads:[],writes:[],ui:['INFO']}],
 recordSets:[],issues:[]};
const run=()=>generatePageSource({appApi:'till',pageApi:'Home',variant:'Desktop',
 page:{canvasWidth:1024,canvasHeight:768,layoutMode:'free-canvas',components},pageCode,pageCodeModuleText:''});
const file=(name:string)=>run().files.find(f=>f.path===name)!.content;

test('file list',()=>{
 assert.deepEqual(run().files.map(f=>f.path),
  ['Home.tsx','Home.css','Home.formulas.ts','Home.actions.ts','Home.data.ts','manifest.json']);
});
test('deterministic',()=>{assert.deepEqual(run().files,run().files);});
test('button nested in container, css position copied',()=>{
 const tsx=file('Home.tsx');
 const open=tsx.indexOf('name="Box"'),button=tsx.indexOf('name="PayButton"'),close=tsx.indexOf('</Smart>');
 assert.ok(open>=0&&button>open&&button<close,'button must sit inside Box');
 assert.match(file('Home.css'),/\.c-PayButton\{[^}]*left:15px;top:25px;/);
});
test('formula, action and unknown formula',()=>{
 const tsx=file('Home.tsx');
 assert.ok(tsx.includes("text={f['c3:text']}"));
 assert.ok(tsx.includes("onClick={a['c2:click']}"));
 const issues=run().issues.filter(i=>i.message.startsWith('Formula not converted'));
 assert.equal(issues.length,1);
 assert.equal(issues[0].componentName,'BadText');
});
test('css mapping',()=>{
 const css=file('Home.css');
 assert.match(css,/\.c-Box\{[^}]*background:#ffffff;[^}]*border-radius:8px;[^}]*box-shadow:0 3px 9px #0003;/);
 assert.match(css,/\.c-PayButton\{[^}]*color:#112233;[^}]*font-size:14px;/);
 assert.match(css,/\.c-TotalText\{[^}]*border:1px solid #cccccc;[^}]*font-weight:700;/);
});
test('generated files parse with esbuild',()=>{
 for(const f of run().files)if(/\.(tsx|ts)$/.test(f.path))
  assert.doesNotThrow(()=>transformSync(f.content,{loader:'tsx'}),f.path);
});
test('versionsToDelete keeps newest 10',()=>{
 assert.deepEqual(versionsToDelete(Array.from({length:12},(_,i)=>i+1)),[1,2]);
 assert.deepEqual(versionsToDelete([3,4]),[]);
});
