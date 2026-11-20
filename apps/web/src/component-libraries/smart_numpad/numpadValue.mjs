/** Values are strings so PIN leading zeroes survive; never fetch or persist credentials here. */
const limit=(value,fallback,min,max)=>{
 const parsed=Number(value);
 return Number.isFinite(parsed)?Math.max(min,Math.min(max,Math.floor(parsed))):fallback;
};
export const numpadSettings=(props={})=>({
 mode:["integer","decimal","pin","date"].includes(props.numpadInputMode)?props.numpadInputMode:"integer",
 maxDigits:limit(props.numpadMaxDigits,12,1,64),
 decimals:limit(props.numpadDecimalPlaces,2,0,12)
});
/** Date mode: digits only, shown as DD/MM/YYYY while typing (slashes added for you). */
const dateText=raw=>{
 const iso=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw??""));
 const digits=iso?iso[3]+iso[2]+iso[1]:String(raw??"").replace(/\D/g,"").slice(0,8);
 return digits.slice(0,2)+(digits.length>2?"/"+digits.slice(2,4):"")+(digits.length>4?"/"+digits.slice(4):"");
};
export function normalizeNumpadValue(raw,settings){
 const {mode,maxDigits,decimals}=settings;
 if(mode==="date")return dateText(raw);
 let input=String(raw??"").replace(/[^0-9.]/g,"");
 if(mode!=="decimal")return input.replace(/\./g,"").slice(0,maxDigits);
 const dot=input.indexOf(".");
 if(dot>=0)input=input.slice(0,dot+1)+input.slice(dot+1).replace(/\./g,"");
 const [whole,fraction]=input.split(".");
 const limited=whole.slice(0,maxDigits);
 const remaining=Math.max(0,maxDigits-limited.length);
 return fraction===undefined?limited:limited+(decimals>0?".":"" )+
   (decimals>0?fraction.slice(0,Math.min(decimals,remaining)):"");
}
export function applyNumpadKey(current,key,settings){
 const value=String(current??"");
 if(key==="C")return "";
 if(settings.mode==="date"){
  const digits=value.replace(/\D/g,"");
  if(key==="backspace")return dateText(digits.slice(0,-1));
  return /^[0-9]$/.test(key)?dateText(digits+key):value;
 }
 if(key==="backspace")return value.slice(0,-1);
 if(key==="."&&settings.mode!=="decimal")return value;
 if(!/^[0-9.]$/.test(key))return value;
 if(key==="."&&value.includes("."))return value;
 return normalizeNumpadValue(value+key,settings);
}
