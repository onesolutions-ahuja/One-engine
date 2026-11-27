import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScreenAction} from '../../server/src/expression-engine/ActionFormulas.ts';
import {multiPageTabId,multiPageName} from '../src/core/pages/TemplatePageRuntime/pageComponentLayout.ts';
import {tabNumber,addressShowsPage} from '../src/core/pages/PageRuntime/multiPageScreens.ts';
import {moveMultiPageTab,nextTabId,selectedMultiPage,stampAllTabIds} from '../src/core/builders/PageBuilder/multiPageBuilder.ts';
import {actionArgumentSuggestions} from '../src/core/builders/PageBuilder/actionArgumentSuggestions.ts';
import {screenTargetsOf} from '../src/core/builders/PageBuilder/screenTargets.ts';


const mp={id:'mp',type:'Custom:smart_multipage',label:'Pages',visible:true,properties:{navigatorName:'ReportsPages'}};
const tab=(id:string,label:string,pageIndex?:number)=>({id,type:'Custom:smart_container',label,visible:true,
 properties:{layoutParentId:'mp',...(pageIndex===undefined?{}:{pageIndex})}});

test('SCREEN(page, MultiPage, tab id) in any order after the page',()=>{
 assert.deepEqual(parseScreenAction('SCREEN(reports, ReportsPages, 1)'),
  {page:'reports',mode:'current',record:undefined,multiPage:'ReportsPages',tab:1,modeGiven:false});
 const opened=parseScreenAction('SCREEN(reports, current, ReportsPages, 2)');
 assert.equal(opened.multiPage,'ReportsPages');assert.equal(opened.tab,2);assert.equal(opened.modeGiven,true);
 const timed=parseScreenAction('SCREEN(display, Steps, 3, 5)');
 assert.equal(timed.tab,3);assert.equal(timed.seconds,5);
 const popup=parseScreenAction('SCREEN(pay, popup, @ThisPage.Cart.recordId)');
 assert.equal(popup.mode,'popup');assert.equal('multiPage' in popup,false);
 // Old layer numbers are gone: a bare number needs a MultiPage name before it.
 assert.throws(()=>parseScreenAction('SCREEN(reports, 2)'),/MultiPage name before the tab/);
});

test('tab ids stay with their tabs when moved, renamed or a tab is deleted',()=>{
 const tabs=[tab('a','Inventory'),tab('b','Sales')];
 assert.equal(multiPageTabId(tabs[1],tabs),1);
 assert.equal(multiPageName(mp as never),'ReportsPages');
 const moved=moveMultiPageTab([mp,...tabs] as never,'b',-1);
 const after=moved.filter(item=>item.id!=='mp');
 assert.deepEqual(after.map(item=>[item.id,item.properties.pageIndex]),[['b',1],['a',0]]);
 // Delete Inventory (id 0): Sales keeps id 1, the next new tab is 2.
 const kept=stampAllTabIds([mp,...tabs] as never).filter(item=>item.id!=='a');
 assert.equal(multiPageTabId(kept.find(item=>item.id==='b')!,kept.filter(item=>item.id!=='mp')),1);
 assert.equal(nextTabId(kept,'mp'),2);
 assert.equal(nextTabId([{...mp,properties:{...mp.properties,multiPageNextTab:7}},...tabs] as never,'mp'),7);
});

test('formula suggestions: MultiPages after SCREEN(page, and tab ids after the MultiPage',()=>{
 const targets=screenTargetsOf([mp,tab('a','Inventory',0),tab('b','Sales',4)] as never);
 assert.deepEqual(targets,[{name:'ReportsPages',tabs:[{id:0,label:'Inventory'},{id:4,label:'Sales'}]}]);
 const look=(page:string)=>page==='reports'?targets:undefined;
 const second=actionArgumentSuggestions('=SCREEN(reports, ',[],[],[],[],[],look);
 assert.ok(second?.choices.some(item=>item.apiName==='ReportsPages'));
 assert.ok(second?.choices.some(item=>item.apiName==='popup'));
 const third=actionArgumentSuggestions('=SCREEN(reports, ReportsPages, ',[],[],[],[],[],look);
 assert.deepEqual(third?.choices.map(item=>item.apiName),['0','4']);
});

test('MultiPage bar follows the selected MultiPage or what is inside it',()=>{
 const inner={id:'btn',type:'Custom:smart_button',label:'Go',visible:true,properties:{layoutParentId:'a'}};
 const all=[mp,tab('a','Inventory'),inner] as never[];
 assert.equal(selectedMultiPage(all,'btn')?.id,'mp');
 assert.equal(selectedMultiPage(all,'mp')?.id,'mp');
 assert.equal(selectedMultiPage(all,'nothing'),undefined);
});

test('tab numbers and page addresses',()=>{
 assert.equal(tabNumber('3'),3);assert.equal(tabNumber(-1),null);assert.equal(tabNumber('x'),null);
 assert.equal(addressShowsPage('reports','/une/apps/A/pages/Reports'),true);
 assert.equal(addressShowsPage('reports','/une/apps/A/pages/other'),false);
});

test('deleting a tab keeps the ids of the tabs left',async()=>{
 const {keepTabIds}=await import('../src/core/builders/PageBuilder/multiPageBuilder.ts');
 const before=[mp,tab('a','Inventory'),tab('b','Sales'),tab('c','Stock')] as never[];
 const after=keepTabIds(before,before.filter((item:{id:string})=>item.id!=='a'));
 assert.deepEqual(after.filter((item:{id:string})=>item.id!=='mp').map((item:{properties:{pageIndex:number}})=>item.properties.pageIndex),[1,2]);
});
