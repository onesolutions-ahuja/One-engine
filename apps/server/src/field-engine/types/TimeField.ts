import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** TimeField: time metadata descriptor. */
export const TimeDefinition:FieldTypeDefinition=Object.freeze({
 name:'TimeField',dataType:'time',kind:'date',
 storage:'record'
});

export function normalizeTimeField(value:unknown,key:string):string{
 if(typeof value!=='string')throw new Error('Invalid time field: '+key);
 const match=/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(value);
 if(!match)throw new Error('Invalid time field: '+key);
 return `${match[1]}:${match[2]}:${match[3]??'00'}.${(match[4]??'').padEnd(3,'0')}`;
}
