import type {PageLayoutMetadata} from '../../metadata/Definitions/metadata';
type Condition=NonNullable<PageLayoutMetadata['actionVisibility']>[string];
/** Visibility is presentation only; Object/Action authorization remains server-side. */
export function recordActionConditionVisible(
 condition:Condition,record:Record<string,unknown>|null|undefined,fieldReadable:boolean
):boolean{
 if(!record||!fieldReadable)return false;
 const value=record[condition.fieldApiName];
 const text=value===null||value===undefined?'':String(value);
 switch(condition.operator??'Equals'){
  case 'Equals':return text===condition.equalsValue;
  case 'NotEquals':return text!==condition.equalsValue;
  case 'Contains':return Boolean(condition.equalsValue)&&
    text.toLocaleLowerCase().includes(condition.equalsValue.toLocaleLowerCase());
  case 'IsBlank':return !text.trim();
  case 'IsNotBlank':return Boolean(text.trim());
  default:return false;
 }
}
