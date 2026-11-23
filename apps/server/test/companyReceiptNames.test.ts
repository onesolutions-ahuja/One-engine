import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCompanyValues} from '../src/system-support/tenant-formula-values.js';

// A fake db: no settings, a tenant name, and no Company record yet (every receipt field blank).
const db={query:async(sql:string)=>sql.includes('md_tenants')&&!sql.includes('md_records')
 ?{rows:[{name:'Shop'}]}:{rows:[]}};

test('receipt settings answer to the Company field name and the settings key',async()=>{
 const values=await loadCompanyValues(db as never,'t1');
 // Blank fields still exist with their default, so @ThisTenant.Company.ReceiptAutoPrint never throws.
 assert.equal(values.receiptautoprint,true);
 assert.equal(values.autoprintreceipt,true);
 assert.equal(values.cardsurchargeon,false);
 assert.equal(values.cardsurchargeenabled,false);
 assert.equal(values.cashroundingon,false);
 assert.equal(values.cashroundingenabled,false);
});
