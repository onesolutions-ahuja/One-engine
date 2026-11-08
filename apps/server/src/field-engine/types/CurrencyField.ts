import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** CurrencyField: currency metadata descriptor. */
export const CurrencyDefinition:FieldTypeDefinition=Object.freeze({
 name:'CurrencyField',dataType:'currency',kind:'numeric',
 storage:'record'
});

export {normalizeNumberField as normalizeCurrencyField} from './NumberField.js';
