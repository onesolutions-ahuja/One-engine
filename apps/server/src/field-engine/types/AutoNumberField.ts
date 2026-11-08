import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** AutoNumberField: autonumber metadata descriptor. */
export const AutoNumberDefinition:FieldTypeDefinition=Object.freeze({
 name:'AutoNumberField',dataType:'autonumber',kind:'system',
 storage:'record'
});

// Existing shared runtime implementation — preserved verbatim.
export function formatAutoNumberValue(format:string,sequence:number,year=new Date().getUTCFullYear()) {
  if(!Number.isSafeInteger(sequence)||sequence<1)
    throw new Error('Auto Number sequence exceeds the supported range');
  const sequencePattern=/\{(0+)\}/g;
  const hasSequencePattern=sequencePattern.test(format);
  sequencePattern.lastIndex=0;
  if(!hasSequencePattern&&!/\{YYYY\}/.test(format))
    throw new Error('Invalid auto-number format');
  const rendered=format.replace(sequencePattern,(_token,zeros:string)=>
    String(sequence).padStart(zeros.length,'0')).replace(/\{YYYY\}/g,String(year));
  return hasSequencePattern?rendered:`${rendered}-${sequence}`;
}
