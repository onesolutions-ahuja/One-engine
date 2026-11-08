import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** LongTextAreaField: longtext metadata descriptor. */
export const LongTextAreaDefinition:FieldTypeDefinition=Object.freeze({
 name:'LongTextAreaField',dataType:'longtext',kind:'text',
 storage:'record'
});

export {validateTextField as validateLongTextAreaField} from './TextField.js';
