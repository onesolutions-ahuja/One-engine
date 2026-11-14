import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connectionKey,isConnected,findConnectedReferences,resolveConnectedCalls,isSystemConnection}
 from '../../server/src/expression-engine/FormulaConnections.ts';
import {detectAppPrerequisites,parsePrerequisites,connectorInstallNeeded,messageActionCredentialNames}
 from '../../server/src/system-support/app-prerequisites.ts';
import {validateFormulaFunctions} from '../../server/src/expression-engine/FormulaFunctionRegistry.ts';
import {Parser} from '../../server/src/expression-engine/FormulaParser.ts';
import {tokenize} from '../../server/src/expression-engine/FormulaTokenizer.ts';
import {evaluateFieldExpressionDetailed} from '../src/component-libraries/shared/FieldExpression.js';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const snapshot={systemAvailable:['whatsapp','sms_gate','brevo'],systemConnected:['whatsapp'],customConnected:['my_api','whatsapp']};
const parse=(formula:string)=>new Parser(tokenize(formula)).parse();

test('connection names: onesys_ prefix, case and dashes all mean the same connector',()=>{
 assert.equal(connectionKey('WhatsApp'),'whatsapp');
 assert.equal(connectionKey('onesys_whatsapp'),'whatsapp');
 assert.equal(connectionKey('sms-gate'),'sms_gate');
 assert.equal(connectionKey(' My_API '),'my_api');
 assert.equal(connectionKey('bad name!'),'');
 assert.equal(isSystemConnection(snapshot,'whatsapp'),true);
 assert.equal(isSystemConnection(snapshot,'my_api'),false);
 // A future connector not yet listed is still recognised by its onesys_ name.
 assert.equal(isSystemConnection(snapshot,'onesys_new_shop'),true);
});

test('CONNECTED() is TRUE only when connected, and a custom callout cannot pose as a connector',()=>{
 assert.equal(isConnected(snapshot,'whatsapp'),true);
 assert.equal(isConnected(snapshot,'onesys_whatsapp'),true);
 assert.equal(isConnected(snapshot,'sms_gate'),false,'installed or not, no keys means FALSE');
 assert.equal(isConnected(snapshot,'my_api'),true);
 assert.equal(isConnected(snapshot,'other_api'),false);
 // customConnected contains a tenant callout called "whatsapp": it must not count.
 assert.equal(isConnected({...snapshot,systemConnected:[]},'whatsapp'),false);
 assert.equal(isConnected(null,'whatsapp'),false);
});

test('CONNECTED() works in page formulas (browser) with the session snapshot',()=>{
 // Display formulas may return TRUE/FALSE as text; Visible treats both alike.
 const run=(formula:string,connections=snapshot)=>
  String(evaluateFieldExpressionDetailed(formula,{},{connections} as never).value).toLowerCase();
 assert.equal(run('CONNECTED("whatsapp")'),'true');
 assert.equal(run('NOT(CONNECTED("sms_gate"))'),'true');
 assert.equal(run('IF(CONNECTED("my_api"),"Send","Hidden")'),'send');
 assert.equal(run('CONNECTED("whatsapp")',{...snapshot,systemConnected:[]}),'false');
});

test('CONNECTED() works in server page actions by swapping in TRUE/FALSE first',()=>{
 const node=resolveConnectedCalls(parse('IF(CONNECTED("whatsapp"),1,0)+IF(CONNECTED("brevo"),10,0)'),snapshot);
 assert.equal(JSON.stringify(node).includes('CONNECTED'),false);
 assert.match(JSON.stringify(node),/"value":true/);
 assert.match(JSON.stringify(node),/"value":false/);
 assert.throws(()=>resolveConnectedCalls(parse('CONNECTED(@Name)'),snapshot),/connector name in quotes/);
});

test('CONNECTED() is allowed in page formulas but not in flow or field formulas',()=>{
 assert.doesNotThrow(()=>validateFormulaFunctions(parse('CONNECTED("whatsapp")'),'ribbon_binding'));
 assert.doesNotThrow(()=>validateFormulaFunctions(parse('CONNECTED("whatsapp")'),'component_visibility'));
 assert.throws(()=>validateFormulaFunctions(parse('CONNECTED("whatsapp")'),'flow_formula'));
 assert.throws(()=>validateFormulaFunctions(parse('CONNECTED("a","b")'),'ribbon_binding'));
});

const catalogue={
 systemKeys:['whatsapp','sms_gate','brevo'],
 connectorFor:(key:string)=>({whatsapp:{appApi:'WhatsAppConnector',label:'WhatsApp Connector'},
  sms_gate:{appApi:'SmsGateConnector',label:'SMS Gate Connector'},
  brevo:{appApi:'BrevoConnector',label:'Brevo Connector'}} as Record<string,{appApi:string;label:string}>)[key],
 publisherBindings:new Map([['whatsapp business','whatsapp']])
};

test('publish finds prerequisites by itself: guarded = optional, unguarded = required',()=>{
 const contents={
  pages:[{apiName:'Till',components:[
   {type:'smart_button',properties:{visible:'=CONNECTED("whatsapp")',
    action:'WHATSAPP("onesys_whatsapp",@Customer.Phone,"Your invoice")'}},
   {type:'smart_button',properties:{action:'SMS("onesys_sms_gate",@Customer.Phone,"Thanks")'}},
   {type:'smart_label',properties:{visible:'CONNECTED("loyalty_api")'}}]}],
  flows:[
   {apiName:'SendInvoice',elements:[{config:{namedCredentialApiName:'WhatsApp Business'}}]},
   {apiName:'SyncStock',elements:[{config:{namedCredentialApiName:'stock_api'}}]}]
 };
 const found=detectAppPrerequisites(contents,catalogue);
 const by=(name:string)=>found.find(item=>(item.kind==='connector'?item.key:item.name)===name);
 const whatsapp=by('whatsapp');
 assert.equal(whatsapp?.kind,'connector');
 assert.equal(whatsapp?.optional,true,'guarded by CONNECTED("whatsapp")');
 assert.equal(whatsapp?.kind==='connector'&&whatsapp.usedByFlows,true);
 assert.deepEqual(whatsapp?.kind==='connector'&&whatsapp.credentialNames,['WhatsApp Business','onesys_whatsapp'],
  'legacy publisher name is mapped through the connector binding');
 const sms=by('sms_gate');
 assert.equal(sms?.optional,false,'used by a page action without a CONNECTED guard');
 assert.equal(by('stock_api')?.kind,'callout');
 assert.equal(by('stock_api')?.optional,false);
 assert.equal(by('loyalty_api')?.optional,true);
 assert.equal(by('brevo'),undefined,'unused connectors are never listed');
 // Stored and read back with the published version.
 assert.deepEqual(parsePrerequisites(JSON.parse(JSON.stringify(found))),found);
 assert.deepEqual(parsePrerequisites('bad'),[]);
});

test('install rules: connectors needed by flows or required are installed with the app',()=>{
 const base={kind:'connector' as const,key:'whatsapp',appApi:'WhatsAppConnector',label:'WhatsApp Connector',credentialNames:[]};
 assert.equal(connectorInstallNeeded({...base,optional:false,usedByFlows:false}),true);
 assert.equal(connectorInstallNeeded({...base,optional:true,usedByFlows:true}),true,'a flow cannot install without it');
 assert.equal(connectorInstallNeeded({...base,optional:true,usedByFlows:false}),false,'optional: never forced');
 assert.deepEqual(messageActionCredentialNames(['EMAIL("onesys_brevo",@A,"S","B")','WHATSAPP( "x" ,1,2)']),
  ['onesys_brevo','x']);
 assert.deepEqual(findConnectedReferences({a:['IF(CONNECTED( "WhatsApp" ),1,0)'],b:'connected'}),['WhatsApp']);
});

test('install flow is wired end to end',()=>{
 const service=read('../../server/src/system-support/app-publishing-service.ts');
 assert.match(service,/prerequisites=await this\.detectPrerequisites\(actor\.tenant_id,manifest\.contents\)/);
 assert.match(service,/options\.installPrerequisites/);
 assert.match(service,/credentialAliases:prerequisites\.aliases/);
 assert.match(read('../../server/src/system-support/server.ts'),/installPrerequisites:req\.body\?\.installPrerequisites===true/);
 assert.match(read('../../server/src/system-support/system-migrations.ts'),/ADD COLUMN IF NOT EXISTS prerequisites jsonb/);
 assert.match(read('../../server/src/system-files/session-metadata.ts'),/loadConnectionSnapshot\(db,tenantId\)/);
 assert.match(read('../../server/src/system-support/formula-data-action-runtime.ts'),/resolveConnectedCalls\(node,connections\)/);
 const screen=read('../src/core/applications/AppExchange/AppExchange.tsx');
 assert.match(screen,/'Install both'/);
 assert.match(screen,/Connections this app uses/);
});
