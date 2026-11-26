import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePageSource} from '../src/page-compiler/source/generatePageSource.js';
import {readPageSource,pageDifferences} from '../src/page-compiler/source/readPageSource.js';
import {buildPageCode} from '../src/page-compiler/code/pageCode.js';
import {compilePage} from '../src/page-compiler/compilePage.js';

/** A page with every kind of value the generator must keep: formulas, actions (one that does
 * not convert), nested containers, layers, odd property names, look in CSS and look that
 * cannot be CSS, hidden components, a repeated name, extra position parts. */
const page={apiName:'Till',label:'Till',pageType:'App Page',layoutMode:'free-canvas',canvasWidth:1280,canvasHeight:800,
 canvasFillColor:'#f5f5f7',layoutVariant:'Custom',customTargetEnabled:true,customTargetMinWidth:900,customTargetMaxWidth:4000,
 activationAssignments:[{id:'a1',scope:'App Default',appId:'SHOP',formFactors:['Custom']}],
 components:[
  {id:'box',type:'Custom:smart_container',label:'Box',visible:true,position:{x:10,y:20,width:300,height:200},
   properties:{navigatorName:'Box',backgroundColor:'#ffffff',radius:8,shadow:'medium',headerBold:false}},
  {id:'pay',type:'Custom:smart_button',label:'Pay',visible:true,position:{x:15,y:25,width:100,height:40,z:3},
   properties:{navigatorName:'Pay',layoutParentId:'box',labelColor:'#112233',textSize:'14',pageLayer:2,
    caption:'Pay "now" & <go>',type:'primary',id:'clash',disabled:false,options:[1,'two',{three:3}],
    'data-x':'y',label:'=IF(1=1,"A","B")',
    actionFlows:{click:{kind:'Formula',formula:'=SCREEN(pay_popup, popup)'},hold:{kind:'Formula',formula:'=NOTAFUNCTION((('}}}},
  {id:'total',type:'Custom:smart_text',label:'Total',visible:false,position:{x:5,y:80,width:120,height:30},
   properties:{navigatorName:'Pay',textSource:'=SUM(1,2)',borderColor:'#cccccc',labelAlignment:'right',bad:'=UNKNOWN(('}},
  {id:'free',type:'Custom:smart_text',properties:{navigatorName:'Free',backgroundColor:' padded ',text:'line1\nline2'}}
 ]};

const build=()=>{
 const compiled=compilePage(page as never,[{apiName:'Product',fields:[{apiName:'Name',dataType:'Text'}]}],{strictLegacy:true});
 const pageCode=buildPageCode(compiled);
 return generatePageSource({appApi:'SHOP',pageApi:'Till',variant:'Custom',page:page as never,pageCode});
};
const asFiles=(source:ReturnType<typeof build>)=>Object.fromEntries(source.files.map(file=>[file.path,file.content]));

test('reading the code back gives the same page (nothing lost)',()=>{
 const read=readPageSource(asFiles(build()),'Till');
 assert.deepEqual(pageDifferences(page as never,read.page),[]);
});

test('a developer edit in the .css or the .tsx is what the page becomes',()=>{
 const files=asFiles(build());
 files['Till.css']=files['Till.css'].replace('background: #ffffff','background: #0000ff');
 files['Till.tsx']=files['Till.tsx'].replace('caption={"Pay','caption={"Charge');
 const read=readPageSource(files,'Till').page;
 assert.equal(read.components[0].properties!.backgroundColor,'#0000ff');
 assert.match(String(read.components[1].properties!.caption),/^Charge/);
});

test('the files are the same every time and read like hand-written code (names, tags, plain refs)',()=>{
 assert.deepEqual(build().files,build().files);
 const files=asFiles(build());
 const tsx=files['Till.tsx'];
 assert.match(tsx,/export default function TillPage\(\)/);
 assert.match(tsx,/import \{Button, Container, Text\} from '@une\/ui';/);
 assert.match(tsx,/<Button className="Pay" layer=\{2\}/);
 assert.match(tsx,/onClick=\{a\.Pay\.click\}/);
 assert.match(tsx,/label=\{f\.Pay\.label\}/);
 assert.match(tsx,/<Text className="Pay-2" name="Pay" hidden/);
 assert.doesNotMatch(tsx,/<Smart|import-|id="pay"|layoutParentId/);
 assert.match(files['Till.formulas.ts'],/\n  Pay: \{\n    label: \{\n      source: /);
 assert.match(files['Till.actions.ts'],/\n  Pay: \{\n    click: \{\n      flow: /);
 const names=JSON.parse(files['manifest.json']).names;
 assert.equal(names.ui.Button,'Custom:smart_button');
 assert.deepEqual(names.components.Pay,{id:'pay',label:'Pay'});
 assert.match(tsx,/parent="Box"/);
 assert.equal(names.components['Pay-2'].id,'total');
});

test('a function a developer wrote is reported (device only), never run by the server',()=>{
 const files=asFiles(build());
 files['Till.tsx']=files['Till.tsx'].replace('caption={"Pay','onTap={() => alert(1)} caption={"Pay');
 const read=readPageSource(files,'Till');
 assert.ok(read.issues.some(issue=>/onTap: not a plain value/.test(issue)));
});
