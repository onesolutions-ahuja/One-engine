/** Migrate tenant-authored Formula and validation definitions without resetting their rules. */
import {SqlPersistence} from '../../apps/server/dist-system/system-files/sql-persistence.js';
import {hasLegacyCartReference,rewriteLegacyCartText,loadLegacyCartIdMap} from './cart-legacy-references.mjs';

const connectionString=process.env.DATABASE_URL??process.env.METADRIVE_DATABASE_URL;
if(!connectionString)throw Error('DATABASE_URL is required');
const db=new SqlPersistence(connectionString);
const apply=process.argv.includes('--apply');
const tables=[
 {name:'md_field_definitions',column:'formula_expression',keys:['object_api','api_name'],where:'deleted_at IS NULL'},
 {name:'md_field_default_formulas',column:'expression',keys:['object_api','field_api'],where:'true'},
 {name:'md_validation_rules',column:'expression',keys:['object_api','api_name'],where:'true'}
];
try{
 const {rows:tenants}=await db.query('SELECT id FROM md_tenants ORDER BY id');
 const result=[];
 for(const {id:tenant} of tenants){
  await db.transaction(async client=>{
   const cartIds=await loadLegacyCartIdMap(client,tenant);
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cart-formulas:'+tenant]);
   for(const table of tables){
    const {rows}=await client.query(
     'SELECT '+table.keys.join(',')+','+table.column+' AS formula FROM '+table.name+
     ' WHERE tenant_id=$1 AND '+table.where+' AND '+table.column+' IS NOT NULL FOR UPDATE',[tenant]);
    for(const item of rows){
     if(!hasLegacyCartReference(item.formula)&&
        ![...cartIds.keys()].some(id=>item.formula.includes(id)))continue;
     const updated=rewriteLegacyCartText(item.formula,{cartIds});
     if(hasLegacyCartReference(updated))throw Error('Legacy Cart formula was not converted');
     result.push({tenant,table:table.name,object:item.object_api,field:item.api_name??item.field_api});
     if(!apply)continue;
     const predicates=table.keys.map((key,i)=>key+'=$'+(i+2)).join(' AND ');
     await client.query('UPDATE '+table.name+' SET '+table.column+'=$'+(table.keys.length+2)+
      ' WHERE tenant_id=$1 AND '+predicates,
      [tenant,...table.keys.map(key=>item[key]),updated]);
    }
   }
  });
 }
 console.log(JSON.stringify({mode:apply?'migrated':'preflight',formulas:result},null,2));
}finally{await db.close();}
