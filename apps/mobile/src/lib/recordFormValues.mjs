// Pure record-form conversion so native app and Node contract tests use identical logic.
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export const fieldType=field=>{
 const type=String(field.dataType??'').toLowerCase().replace(/[^a-z]/g,'');
 return ({
   checkbox:'boolean',multiselectpicklist:'multipicklist',
   lookup:'reference',masterdetail:'reference',hierarchical:'reference',
   longtextarea:'longtext',datetimestamp:'datetime'
 })[type]??type;
};
export const safeField=(field,mode)=>(mode==='create'?field.canCreate:field.canEdit)
 && !['formula','rollup','autonumber'].includes(fieldType(field));
export function serializeChangedFields(fields,values,changed,mode){
 const result={};
 for(const field of fields){
  if(!safeField(field,mode))continue;
  const name=field.apiName,type=fieldType(field);
  if(mode==='edit'&&!changed.has(name))continue;
  const raw=values[name];
  if(raw===undefined)continue;
  if(type==='boolean'){result[name]=raw===true;continue;}
  if(type==='address'){
   const value=Object.fromEntries(['street','city','state','postalCode','country']
     .map(key=>[key,String(raw?.[key]??'').trim()]));
   if(field.required&&!Object.values(value).some(Boolean))throw new Error(field.label+' is required');
   result[name]=value;continue;
  }
  if(type==='geolocation'){
   const lat=String(raw?.latitude??'').trim(),lon=String(raw?.longitude??'').trim();
   if(!lat&&!lon){if(field.required)throw new Error(field.label+' is required');result[name]=null;continue;}
   if(!lat||!lon||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))
     ||Number(lat)<-90||Number(lat)>90||Number(lon)<-180||Number(lon)>180)
     throw new Error('Enter valid latitude and longitude for '+field.label);
   result[name]={latitude:Number(lat),longitude:Number(lon)};continue;
  }
  if(type==='encryptedtext'&&mode==='edit'&&!String(raw).trim())continue;
  const str=String(raw??'').trim();
  if(!str&&field.required)throw new Error(field.label+' is required');
  if(!str){result[name]=null;continue;}
  if(['number','currency','percent'].includes(type)){
   if(!Number.isFinite(Number(str)))throw new Error('Enter a valid number for '+field.label);
   result[name]=Number(str);
  }else if(type==='datetime'){
   if(Number.isNaN(new Date(str).getTime()))throw new Error('Enter a valid ISO date and time for '+field.label);
   result[name]=new Date(str).toISOString();
  }else if(type==='date'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(str)||Number.isNaN(Date.parse(str)))throw new Error('Use YYYY-MM-DD for '+field.label);
   result[name]=str;
  }else if(type==='reference'){
   if(!uuid.test(str))throw new Error('Choose a valid '+field.label+' record');
   result[name]=str;
  }else result[name]=str;
 }
 if(Object.keys(result).length===0)throw new Error('No editable changes to save.');
 return result;
}
