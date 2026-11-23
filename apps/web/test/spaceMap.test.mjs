import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {disabledWhen} from '../src/component-libraries/shared/showWhen.js';

test('Disabled and Item disabled when evaluate the current record',()=>{
 const p={disabledFormula:true,itemDisabledWhen:'=@Product.Active',__formulaCode:{compile:()=>row=>row.Active}};
 assert.equal(disabledWhen(p),true);
 assert.equal(disabledWhen(p,{Active:true},'itemDisabledWhen'),true);
 assert.equal(disabledWhen(p,{Active:false},'itemDisabledWhen'),false);
 assert.equal(disabledWhen({...p,builderPreview:true}),false);
});

test('Space Map renders records and writes snapped positions on drag',async()=>{
 const output=await build({entryPoints:[new URL('../src/component-libraries/smart_spacemap/SmartComponent.jsx',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,format:'cjs',write:false});
 const module={exports:{}};
 const hooks={...React,useRef:current=>({current}),useEffect:()=>{},useState:initial=>[initial,()=>{}]};
 new Function('module','exports','React','require',output.outputFiles[0].text)(module,module.exports,hooks,createRequire(import.meta.url));
 const writes=[],events=[];
 const row={Id:'slot',Name:'Bay 2',PosX:20,PosY:30};
 const rendered=module.exports.default({records:[row],mapMode:'Edit',xField:'PosX',yField:'PosY',gridSize:10,
  writeMapRecord:async(...args)=>writes.push(args),onAction:action=>events.push(action)});
 const find=(node,predicate)=>{
  if(!React.isValidElement(node))return null;
  if(predicate(node))return node;
  return React.Children.toArray(node.props.children).map(child=>find(child,predicate)).find(Boolean);
 };
 const tile=find(rendered,node=>node.props.className==='space-map-tile');
 assert.equal(find(tile,node=>node.type==='strong').props.children,'Bay 2');
 assert.equal(tile.props.style.left,20);
 const event={button:0,pointerId:1,clientX:0,clientY:0,target:{dataset:{}},currentTarget:{setPointerCapture(){}}};
 tile.props.onPointerDown(event);
 tile.props.onPointerMove({...event,clientX:17,clientY:29});
 tile.props.onPointerUp({...event,type:'pointerup'});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(writes,[['PUT','slot',{PosX:40,PosY:60}]]);
 assert.equal(events[0].event,'change');
});
