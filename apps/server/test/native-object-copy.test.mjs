import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeCopyPlan,nativeColumnName,nativeFieldType,nativeTableName} from '../src/system-files/native-object-copy.ts';

test('physical identifiers preserve case identity and cannot contain metadata SQL',()=>{
  assert.notEqual(nativeTableName('Product'),nativeTableName('product'));
  const a={api_name:'Price',data_type:'currency',standard:true};
  assert.notEqual(nativeColumnName(a),nativeColumnName({...a,data_type:'text'}));
  assert.match(nativeColumnName(a),/^f_[a-f0-9]{32}$/);
  assert.throws(()=>nativeCopyPlan('Product; DROP TABLE md_records',[]),/Invalid object/);
  assert.throws(()=>nativeCopyPlan('Product',[a,a]),/Duplicate/);
});
test('unknown stored types fail closed; formula fields are not persisted',()=>{
  assert.throws(()=>nativeFieldType({api_name:'Secret',data_type:'future',standard:false}),/does not support/);
  assert.equal(nativeFieldType({api_name:'Total',data_type:'rollup',rollup_source_data_type:'date',standard:true}),'date');
  assert.deepEqual(nativeCopyPlan('Product',[{api_name:'Computed',data_type:'formula',standard:true}]).fields,[]);
});
test('custom fields share one extras column; native and custom names receive trigram indexes',()=>{
  const plan=nativeCopyPlan('Product',[
    {api_name:'Name',data_type:'text',standard:true},
    {api_name:'Barcode',data_type:'text',standard:false},
    {api_name:'SpecialPrice',data_type:'currency',standard:false},
    {api_name:'Secret',data_type:'encryptedtext',standard:true}
  ]);
  assert.equal(plan.fields.filter(f=>f.column).length,2);
  assert.equal(plan.ddl.filter(sql=>sql.includes('gin_trgm_ops')).length,2);
  assert.equal(plan.ddl.filter(sql=>sql.includes('CREATE INDEX')).length,2);
  assert.match(plan.verify,/EXCEPT SELECT \* FROM copied/);
  assert.match(plan.verify,/EXCEPT SELECT \* FROM source/);
});
