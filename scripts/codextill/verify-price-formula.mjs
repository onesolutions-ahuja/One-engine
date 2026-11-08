import assert from 'node:assert/strict';
import {PRICE_FORMULA} from './price-formula.mjs';
import {evaluateFieldExpressionDetailed} from '../../apps/web/src/component-libraries/shared/FieldExpression.js';

const examples=[
 [0,'£0.00'],[0.01,'£0.01'],[0.1,'£0.10'],[1.2,'£1.20'],
 [1.25,'£1.25'],[1.999,'£2.00'],[12.34,'£12.34'],
 [12.999,'£13.00'],[199.95,'£199.95']
];
for(const [price,wanted] of examples){
 const result=evaluateFieldExpressionDetailed(PRICE_FORMULA,{Price:price});
 assert.equal(result.error,undefined,'Invalid price formula for '+price+': '+result.error);
 assert.equal(result.value,wanted,'Incorrect GBP formatting for '+price);
}
console.log('CODEXTILL formula verified: '+examples.length+' prices with exactly 2 decimals');
