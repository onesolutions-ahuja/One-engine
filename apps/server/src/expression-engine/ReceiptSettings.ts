export type ReceiptSetting={key:string;field:string;label:string;kind:'text'|'number'|'boolean'|'choice'|'connection'|'url';max?:number;decimals?:number;initial?:string|boolean;options?:string[]};
export const receiptSettings:ReceiptSetting[]=[
 {key:'receiptDisplayName',field:'ReceiptDisplayName',label:'Receipt display name',kind:'text',max:120},
 {key:'vatNumber',field:'VatNumber',label:'Vat number',kind:'text',max:40},
 {key:'receiptMessage',field:'ReceiptMessage',label:'Receipt message',kind:'text',max:500},
 {key:'refundDays',field:'RefundDays',label:'Refund days',kind:'number',max:3650},
 {key:'showVatBreakdown',field:'ReceiptShowVat',label:'Show vat breakdown',kind:'boolean',initial:true},
 {key:'askReceiptChoice',field:'ReceiptAskChoice',label:'Ask receipt choice',kind:'boolean',initial:true},
 {key:'autoPrintReceipt',field:'ReceiptAutoPrint',label:'Auto print receipt',kind:'boolean',initial:true},
 {key:'showReceiptBarcode',field:'ReceiptShowBarcode',label:'Show receipt barcode',kind:'boolean',initial:true},
 {key:'receiptQrUrl',field:'ReceiptQrLink',label:'Receipt qr url',kind:'url',max:2048},
 {key:'receiptQrCaption',field:'ReceiptQrCaption',label:'Receipt qr caption',kind:'text',max:120},
 {key:'showCustomerBalance',field:'ShowCustomerBalance',label:'Show customer balance',kind:'boolean',initial:false},
 {key:'groupSameItems',field:'GroupSameItems',label:'Group same items',kind:'boolean',initial:false},
 {key:'showItemOptions',field:'ShowItemOptions',label:'Show item options',kind:'boolean',initial:true},
 {key:'tipLineEnabled',field:'ReceiptTipLine',label:'Tip line enabled',kind:'boolean',initial:false},
 {key:'tipLinePercents',field:'TipLinePercents',label:'Tip line percents',kind:'text',max:40},
 {key:'receiptEmailConnection',field:'ReceiptEmailConnection',label:'Receipt email connection',kind:'connection',max:128},
 {key:'cardSurchargeEnabled',field:'CardSurchargeOn',label:'Card surcharge enabled',kind:'boolean',initial:false},
 {key:'cardSurchargePercent',field:'CardSurchargePercent',label:'Card surcharge percent',kind:'number',max:10,decimals:2},
 {key:'cashRoundingEnabled',field:'CashRoundingOn',label:'Cash rounding enabled',kind:'boolean',initial:false},
 {key:'cashRoundingStep',field:'CashRoundingStep',label:'Cash rounding step',kind:'choice',initial:'0.05',options:['0.05','0.10','0.50','1.00']},
 {key:'giftCardValidMonths',field:'GiftCardValidMonths',label:'Gift card valid months',kind:'number',max:120},
 {key:'serviceChargePercent',field:'ServiceChargePercent',label:'Service charge percent',kind:'number',max:30,decimals:2},
 {key:'serviceChargeFromCovers',field:'ServiceChargeFromCovers',label:'Service charge from covers',kind:'number',max:100},
];
export function receiptValue(setting:ReceiptSetting,value:unknown){
 if(value==null||value==='')return null;
 let valid=false;
 switch(setting.kind){
  case 'boolean':valid=typeof value==='boolean';break;
  case 'choice':{
   const option=setting.options?.find(option=>value===option||typeof value==='number'&&Number(option)===value);
   if(option)return Number(option);
   break;
  }
  case 'number':valid=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=setting.max!&&Number(value.toFixed(setting.decimals??0))===value;break;
  default:
   valid=typeof value==='string'&&value.length<=setting.max!;
   if(valid&&setting.kind==='url'){try{valid=new URL(String(value)).protocol==='https:';}catch{valid=false;}}
 }
 if(!valid)throw Error('Invalid company profile field '+setting.key);
 return value;
}
