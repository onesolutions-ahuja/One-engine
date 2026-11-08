import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** DateTimeField: datetime metadata descriptor. */
export const DateTimeDefinition:FieldTypeDefinition=Object.freeze({
 name:'DateTimeField',dataType:'datetime',kind:'date',
 storage:'record'
});

export function normalizeDateTimeField(value:unknown,key:string):string{
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||!/Z$|[+-][0-9]{2}:[0-9]{2}$/.test(value))
  throw new Error('Invalid datetime field: '+key);
 return new Date(value).toISOString();
}
