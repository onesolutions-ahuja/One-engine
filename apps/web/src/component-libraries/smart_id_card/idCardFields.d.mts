export const ID_CARD_MAX_FIELDS: number;
export const ID_CARD_DEFAULT_FIELDS: number;
export type IdCardFieldKeys={
 source:string;label:string;offset:string;area:string;
 textColor:string;textSize:string;bold:string;alignment:string;fill:string;border:string;wrap:string;
};
type Props=Readonly<Record<string,unknown>>|null|undefined;
export function idCardFieldKeys(n:number):IdCardFieldKeys;
export const ID_CARD_ROW_PROPERTIES:readonly string[];
export function idCardFieldCount(p:Props):number;
export function idCardFieldColumns(p:Props):number;
export function idCardFieldLayout(p:Props):'inline'|'stacked';
export function idCardFieldSlots(p:Props,builder?:boolean):Array<{n:number;keys:IdCardFieldKeys;configured:boolean}>;
export function idCardFieldStyle(p:Props,n:number):Record<string,string|number>;
export function idCardLabelStyle(p:Props):Record<string,string|number>;
