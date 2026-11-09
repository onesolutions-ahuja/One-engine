#!/usr/bin/env node
// Run every component/formula test and fail only on a NEW failure.
// scripts/test-components-known-failures.txt lists old tests that already fail on
// main (most read migration files that were removed). Fix one → delete its line.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const script=JSON.parse(readFileSync('package.json','utf8')).scripts['test:components'];
const files=script.replace(/^.*run-archived-tests\.mjs\s+/,'').split(/\s+/).filter(Boolean);
const run=spawnSync(process.execPath,['scripts/run-archived-tests.mjs',...files],{encoding:'utf8',maxBuffer:256*1024*1024});
const output=(run.stdout??'')+(run.stderr??'');
const failed=[...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(match=>match[1].trim());
const known=new Set(readFileSync('scripts/test-components-known-failures.txt','utf8').split('\n').map(line=>line.trim()).filter(Boolean));
const fresh=[...new Set(failed)].filter(name=>!known.has(name));
const passed=Number(/^# pass (\d+)/m.exec(output)?.[1]??0);
console.log('passed '+passed+', failed '+failed.length+' ('+(failed.length-fresh.length)+' already known)');
if(!passed){console.error(output.slice(-4000));process.exit(1);}
if(fresh.length){
 console.error('NEW test failures:\n- '+fresh.join('\n- '));
 for(const name of fresh){const at=output.indexOf('not ok');const i=output.indexOf(name,at);console.error(output.slice(i,i+1500));}
 process.exit(1);
}
