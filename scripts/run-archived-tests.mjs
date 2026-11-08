#!/usr/bin/env node
// Execute selected original tests stored inside the consolidated test archives.
// Materialize their sources only for the duration of the test command.
import {readFileSync,existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=process.cwd();
const archives=[
  'apps/web/test/frontend.test.mjs',
  'scripts/scripts.test.mjs'
];
const requested=process.argv.slice(2);
if(!requested.length)throw new Error('Specify at least one archived test path');
const sources=new Map();
for(const archive of archives){
  const contents=readFileSync(path.join(root,archive),'utf8');
  const start=contents.indexOf('const SOURCES=');
  const end=start<0?-1:contents.indexOf(';\n',start);
  if(end<0)throw new Error('Invalid test archive: '+archive);
  for(const [original,content] of JSON.parse(contents.slice(start+'const SOURCES='.length,end))){
    if(sources.has(original))throw new Error('Duplicate archived test: '+original);
    sources.set(original,content);
  }
}
for(const test of requested){
  if(!sources.has(test)&&!existsSync(path.join(root,test)))throw new Error('Test not found: '+test);
}
const created=[];
try{
  for(const [relative,content] of sources){
    const location=path.join(root,relative);
    if(existsSync(location))throw new Error('Archived test path already exists: '+relative);
    mkdirSync(path.dirname(location),{recursive:true});
    writeFileSync(location,content,'utf8');
    created.push(location);
  }
  const env={...process.env};
  delete env.NODE_TEST_CONTEXT;
  const run=spawnSync(process.execPath,
    ['--import','tsx','--test',...requested],{cwd:root,stdio:'inherit',env,timeout:720000});
  if(run.error)throw run.error;
  process.exitCode=run.status??1;
}finally{
  for(const location of created)rmSync(location,{force:true});
}
