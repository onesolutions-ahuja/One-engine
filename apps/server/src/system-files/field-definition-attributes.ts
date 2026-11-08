import {normalizeNumberField} from '../field-engine/types/NumberField.js';
import {normalizeDateField} from '../field-engine/types/DateField.js';
import {normalizeDateTimeField} from '../field-engine/types/DateTimeField.js';
import {normalizeTimeField} from '../field-engine/types/TimeField.js';
import {validateTextField} from '../field-engine/types/TextField.js';
import {validateEmailField} from '../field-engine/types/EmailField.js';
import {validatePhoneField} from '../field-engine/types/PhoneField.js';
import {validateUrlField} from '../field-engine/types/UrlField.js';

/** The same constraints apply to Object Manager, API-created fields and field edits. */
export function validateFieldDefinitionAttributes(field:{
 dataType:string;unique:boolean;externalId:boolean;caseSensitive:boolean;
 maxLength:number|null;precision:number|null;scale:number|null;
 defaultValue:unknown;picklistValues:string[];globalValueSetApiName:string|null;
}):string|null {
 const type=field.dataType;
 if(field.externalId&&!['text','number','email','phone','url','currency','percent','autonumber'].includes(type))
   throw new Error('External ID is unavailable for this field type');
 if(field.unique&&['textarea','longtext','richtext','encryptedtext','formula','rollup',
   'reference','address','geolocation','multipicklist','image','file'].includes(type))
   throw new Error('Unique is not available for this field type');
 if(field.caseSensitive&&(!(field.unique||field.externalId)||!['text','email','phone','url','currency','percent','number'].includes(type)))
   throw new Error('Case sensitivity requires a supported Unique or External ID field');
 if(field.defaultValue===undefined||field.defaultValue===null)return null;
 if(['autonumber','formula','rollup','reference','address','geolocation','encryptedtext',
   'image','file'].includes(type))throw new Error('This field type cannot have a default value');
 const raw=field.defaultValue;
 const invalid=():never=>{throw new Error('Invalid '+type+' field default value');};
 if(type==='boolean'){
   if(raw!==true&&raw!==false&&raw!=='true'&&raw!=='false')invalid();
   return String(raw);
 }
 if(['number','currency','percent'].includes(type)){
   if(typeof raw!=='number'&&
     (typeof raw!=='string'||!raw.trim()||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)))invalid();
   const value=Number(raw);
   if(!Number.isFinite(value))invalid();
   normalizeNumberField(value,'default',field.precision,field.scale);
   return String(raw);
 }
 if(typeof raw!=='string')invalid();
 if(['text','textarea','longtext','richtext','email','phone','url','picklist','multipicklist'].includes(type)){
   validateTextField(raw,'default',field.maxLength);
   if(type==='email'&&raw)validateEmailField(raw,'default');
   if(type==='phone'&&raw)validatePhoneField(raw,'default');
   if(type==='url'&&raw)validateUrlField(raw,'default');
   if(type==='picklist'||type==='multipicklist'){
     const values=type==='multipicklist'?raw.split(';'):[raw];
     if(type==='multipicklist'&&new Set(values).size!==values.length)
       throw new Error('Duplicate multi-select default');
     if(values.some(v=>!v||(!field.globalValueSetApiName&&!field.picklistValues.includes(v))))
       throw new Error('Default value is not in the field picklist');
   }
   return raw;
 }
 if(type==='date')return normalizeDateField(raw,'default');
 if(type==='datetime'){normalizeDateTimeField(raw,'default');return raw as string;}
 if(type==='time'){normalizeTimeField(raw,'default');return raw as string;}
 return invalid();
}
