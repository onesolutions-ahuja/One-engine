/** Company Settings → Receipts. Saved in the company profile and read by page formulas as
 * @ThisTenant.Company.<Key> (e.g. @ThisTenant.Company.ReceiptAutoPrint). Shared by the server
 * (save checks) and Company Settings (form), so both use one list. */
export type ReceiptSetting={key:string;label:string;kind:'text'|'yesno'|'number';help?:string;min?:number;max?:number};
export const RECEIPT_SETTINGS:readonly ReceiptSetting[]=[
 {key:'receiptDisplayName',label:'Name on receipt',kind:'text',help:'Blank = trading name'},
 {key:'vatNumber',label:'VAT number',kind:'text'},
 {key:'receiptMessage',label:'Receipt message',kind:'text',help:'Printed at the bottom, e.g. "Thank you for shopping with us"'},
 {key:'refundDays',label:'Refund within (days)',kind:'number',min:0,max:3650},
 {key:'receiptShowVat',label:'Show VAT breakdown',kind:'yesno'},
 {key:'receiptAskChoice',label:'Ask paper / email / both / none after each sale',kind:'yesno'},
 {key:'receiptAutoPrint',label:'Print a receipt after every sale',kind:'yesno'},
 {key:'receiptShowBarcode',label:'Show receipt barcode (for refunds)',kind:'yesno'},
 {key:'receiptQrLink',label:'QR code link',kind:'text',help:'e.g. your website or review page'},
 {key:'receiptQrCaption',label:'QR code caption',kind:'text'},
 {key:'receiptTipLine',label:'Show a tip line',kind:'yesno'},
 {key:'cardSurchargeOn',label:'Card surcharge',kind:'yesno'},
 {key:'cardSurchargePercent',label:'Card surcharge (%)',kind:'number',min:0,max:100},
 {key:'cashRoundingOn',label:'Round cash totals',kind:'yesno'},
 {key:'cashRoundingStep',label:'Round cash to (£)',kind:'number',min:0,max:1,help:'e.g. 0.05 or 0.10'}
];
/** Checks one Receipts value; returns an error message or null. */
export function receiptSettingError(key:string,value:unknown):string|null{
 const setting=RECEIPT_SETTINGS.find(item=>item.key===key);
 if(!setting)return 'Unknown receipt setting';
 if(setting.kind==='yesno')return typeof value==='boolean'?null:setting.label+' must be Yes or No';
 if(setting.kind==='number'){
  if(value===null||value==='')return null;
  return typeof value==='number'&&Number.isFinite(value)&&value>=(setting.min??-1e12)&&value<=(setting.max??1e12)
   ?null:setting.label+' must be a number from '+(setting.min??0)+' to '+(setting.max??'');
 }
 return typeof value==='string'&&value.length<=2048?null:setting.label+' is too long';
}
