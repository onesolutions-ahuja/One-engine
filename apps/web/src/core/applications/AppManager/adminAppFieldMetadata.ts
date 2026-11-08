import type {AdminControlDefinition} from '../../builders/AdminPropertyControl/AdminPropertyControl';
import type {LightningAppMetadata} from '../../metadata/Definitions/metadata';

/** Single metadata contract for standard App Manager form fields.
 * Existing app CRUD, navigation actions and server RBAC remain authoritative.
 */
export const appManagerFieldDefinitions:readonly AdminControlDefinition[]=[
 {propertyKey:'label',label:'App Label',kind:'TEXT',required:true,maxLength:80,displayOrder:10},
 {propertyKey:'apiName',label:'Developer Name',kind:'TEXT',required:true,maxLength:80,pattern:'[A-Za-z][A-Za-z0-9_]*',displayOrder:20},
 {propertyKey:'brandColor',label:'Brand Color',kind:'COLOR',required:true,inputType:'color',pattern:'#[0-9a-fA-F]{6}',defaultValue:'#0176d3',displayOrder:30},
 {propertyKey:'description',label:'Description',kind:'TEXT',multiline:true,maxLength:500,displayOrder:40}
];
export type AppManagerFieldKey='label'|'apiName'|'brandColor'|'description';
export function validateAppManagerField(key:AppManagerFieldKey,value:unknown):string|null{
 if(typeof value!=='string')return 'A string value is required';
 if(key==='label')return value.trim()&&value.length<=80?null:'App Label must contain 1–80 characters';
 if(key==='apiName')return /^[A-Za-z][A-Za-z0-9_]*$/.test(value)?null:'Invalid Developer Name';
 if(key==='brandColor')return /^#[0-9a-fA-F]{6}$/.test(value)?null:'Brand Color must be a HEX colour';
 return value.length<=500?null:'Description must be at most 500 characters';
}
export function appManagerFieldValues(app:LightningAppMetadata){
 return Object.fromEntries(appManagerFieldDefinitions.map(item=>[item.propertyKey,app[item.propertyKey as AppManagerFieldKey]]));
}
