#!/usr/bin/env node
// Keep the complete component/formula suite as a regression gate.
// Archived tests include inherited failures on main; fail on any NEW failing
// test relative to the exact base branch, never by enlarging the known list.
import {readFileSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

const root=process.cwd();
const known=new Set(readFileSync('scripts/test-components-known-failures.txt','utf8')
 .split('\n').map(line=>line.trim()).filter(Boolean));
function run(cwd){
 const script=JSON.parse(readFileSync(path.join(cwd,'package.json'),'utf8')).scripts['test:components'];
 const files=script.replace(/^.*run-archived-tests\.mjs\s+/,'').split(/\s+/).filter(Boolean);
 const result=spawnSync(process.execPath,[path.join(cwd,'scripts/run-archived-tests.mjs'),...files],
  {cwd,encoding:'utf8',maxBuffer:256*1024*1024,timeout:720000});
 if(result.error)throw result.error;
 const output=(result.stdout??'')+(result.stderr??'');
 const failed=new Set([...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(match=>match[1].trim()));
 const passed=Number(/^# pass (\d+)/m.exec(output)?.[1]??0);
 if(!passed){console.error(output.slice(-5000));throw Error('Component test suite did not run');}
 return {failed,passed,output};
}
function git(args){
 const result=spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:1024*1024,timeout:120000});
 if(result.status!==0)throw Error('git '+args[0]+' failed: '+(result.stderr??'').slice(-1000));
 return (result.stdout??'').trim();
}
function printFailure(testName,output){
 const marker='not ok ';
 const start=output.indexOf(marker);
 const i=output.indexOf(testName,Math.max(0,start));
 if(i>=0)console.error(output.slice(i,Math.min(output.length,i+1600)));
}
const head=run(root);
const unlisted=[...head.failed].filter(name=>!known.has(name));
console.log('PR components: '+head.passed+' passed, '+head.failed.size+' failed, '
 +(head.failed.size-unlisted.length)+' listed as historical failures');
if(!unlisted.length)process.exit(0);

// Never silently turn a failing test into a "known" failure.
// A pull_request run has a pinned base and an authenticated checkout: run the
// same complete suite at main to establish whether each failure is inherited.
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_BASE_REF!=='main'){
 console.error('Unlisted component failures (base comparison unavailable):\n- '+unlisted.join('\n- '));
 for(const name of unlisted)printFailure(name,head.output);
 process.exit(1);
}
let temp='';
let checkout='';
try{
 git(['fetch','--no-tags','--depth=1','origin','refs/heads/main']);
 const baseSha=git(['rev-parse','FETCH_HEAD']);
 temp=mkdtempSync(path.join(tmpdir(),'one-engine-component-baseline-'));
 checkout=path.join(temp,'repo');
 git(['worktree','add','--detach',checkout,baseSha]);
 // npm ci has already installed the same lockfile dependencies in the PR
 // checkout. Reuse them without mutating either the main source or its tests.
 symlinkSync(path.join(root,'node_modules'),path.join(checkout,'node_modules'),'dir');
 const baseline=run(checkout);
 const regressions=unlisted.filter(name=>!baseline.failed.has(name));
 console.log('main @ '+baseSha+': '+baseline.passed+' passed, '+baseline.failed.size+' failed');
 console.log('PR failures already present on main: '+(unlisted.length-regressions.length));
 if(regressions.length){
  console.error('New component regressions versus main:\n- '+regressions.join('\n- '));
  for(const name of regressions)printFailure(name,head.output);
  process.exitCode=1;
 }else console.log('No new component failures versus main');
}catch(error){
 console.error('Could not establish full main-branch test baseline:',error);
 for(const name of unlisted)printFailure(name,head.output);
 process.exitCode=1; // Fail closed if main cannot be checked.
}finally{
 if(checkout){
  try{git(['worktree','remove','--force',checkout]);}
  catch(error){console.error('Failed to remove baseline worktree:',error);process.exitCode=1;}
 }
 if(temp)rmSync(temp,{recursive:true,force:true});
}
