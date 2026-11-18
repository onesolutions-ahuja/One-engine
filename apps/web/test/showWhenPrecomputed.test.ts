import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hiddenByShowWhen} from '../src/component-libraries/shared/showWhen.js';

test('Show when already run by page code (TRUE/FALSE/0) hides or shows the component',()=>{
 assert.equal(hiddenByShowWhen({visibleFormula:false}),true);
 assert.equal(hiddenByShowWhen({visibleFormula:0}),true);
 assert.equal(hiddenByShowWhen({visibleFormula:true}),false);
 assert.equal(hiddenByShowWhen({visibleFormula:''}),false,'blank Show when always shows');
 assert.equal(hiddenByShowWhen({}),false);
 assert.equal(hiddenByShowWhen({visibleFormula:'FORMULAERROR'}),true,'a failed formula hides');
 assert.equal(hiddenByShowWhen({visibleFormula:false,builderPreview:true}),false,'the builder always shows it');
});

test('every Smart renderer applies Show when, including precomputed values',()=>{
 const runtime=readFileSync(new URL('../src/component-libraries/smart/shared/SmartRuntime.jsx',import.meta.url),'utf8');
 assert.match(runtime,/typeof showWhen==="string"\?scopedExpression\(p,"visibleFormula",showWhen,record\):showWhen/);
 for(const kind of ['smart_table','smart_chart','smart_qr','smart_icon'])
  assert.match(readFileSync(new URL('../src/component-libraries/'+kind+'/SmartComponent.jsx',import.meta.url),'utf8'),/hiddenByShowWhen\(p\)/,kind);
});
