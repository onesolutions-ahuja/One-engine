export type FormulaRoundingMode='ROUND'|'ROUNDUP'|'ROUNDDOWN';

export function roundFormulaNumber(value:number,precision:number,mode:FormulaRoundingMode):number {
  const scale=Math.trunc(precision);
  if(!Number.isFinite(value)||!Number.isFinite(scale)||Math.abs(scale)>100)
    throw new Error('Invalid formula rounding precision');
  if(value===0)return 0;

  const negative=value<0;
  const [mantissa,exponentText]=Math.abs(value).toString().toLowerCase().split('e');
  const [integerPart,fractionalPart='']=mantissa.split('.');
  const untrimmedDigits=integerPart+fractionalPart;
  const leadingZeros=untrimmedDigits.length-untrimmedDigits.replace(/^0+/,'').length;
  const digits=untrimmedDigits.slice(leadingZeros)||'0';
  const decimalPosition=integerPart.length+Number(exponentText??0)-leadingZeros;
  const keptDigits=decimalPosition+scale;
  if(keptDigits>=digits.length)return value;

  const firstDiscarded=keptDigits>=0?digits[keptDigits]??'0':'0';
  const discardedDigits=keptDigits>=0?digits.slice(keptDigits):digits;
  const discardedNonZero=/[1-9]/.test(discardedDigits);
  const roundAway=mode==='ROUNDUP'
    ?discardedNonZero
    :mode==='ROUND'&&firstDiscarded>='5';
  let coefficient=BigInt(digits.slice(0,Math.max(0,keptDigits))||'0');
  if(roundAway)coefficient+=1n;
  if(coefficient===0n)return 0;

  const coefficientText=coefficient.toString();
  const decimalIndex=coefficientText.length-scale;
  const roundedText=decimalIndex<=0
    ?'0.'+'0'.repeat(-decimalIndex)+coefficientText
    :decimalIndex>=coefficientText.length
      ?coefficientText+'0'.repeat(decimalIndex-coefficientText.length)
      :coefficientText.slice(0,decimalIndex)+'.'+coefficientText.slice(decimalIndex);
  const rounded=Number((negative?'-':'')+roundedText);
  if(!Number.isFinite(rounded))throw new Error('Formula result must be finite');
  return rounded;
}
