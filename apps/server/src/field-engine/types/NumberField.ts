import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** NumberField: number metadata descriptor. */
export const NumberDefinition:FieldTypeDefinition=Object.freeze({
 name:'NumberField',dataType:'number',kind:'numeric',
 storage:'record'
});

export const roundDecimal=(value:number,scale:number)=>{
  const [mantissa,exponentText]=value.toString().toLowerCase().split('e');
  const exponent=exponentText?Number(exponentText):0;
  const negative=mantissa.startsWith('-');
  const unsigned=negative?mantissa.slice(1):mantissa;
  const [whole,fraction='']=unsigned.split('.');
  let units=BigInt(whole+fraction);
  const decimalShift=exponent-fraction.length+scale;
  if(decimalShift>=0)units*=10n**BigInt(decimalShift);
  else{
    const divisor=10n**BigInt(-decimalShift);
    const remainder=units%divisor;
    units/=divisor;
    if(remainder*2n>=divisor)units++;
  }
  const digits=units.toString().padStart(scale+1,'0');
  const decimal=scale?`${digits.slice(0,-scale)}.${digits.slice(-scale)}`:digits;
  const text=`${negative&&units!==0n?'-':''}${decimal}`;
  return {text,value:Number(text),units};
};
export function normalizeNumberField(value:unknown,key:string,precision:number|null|undefined,scale:number|null|undefined):string{
 if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Invalid number field: '+key);
 if(precision!=null){const rounded=roundDecimal(value,scale??0);if(!Number.isFinite(rounded.value)||rounded.units>=10n**BigInt(precision))throw new Error('Number exceeds field precision or scale: '+key);return rounded.text;}
 return String(value);
}
