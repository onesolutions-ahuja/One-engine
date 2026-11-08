/** Static reusable choice sets authored as SQL Flow resource metadata, not client code. */
export type FlowChoiceResource={name:string;type:string;value?:unknown};
type Screen={id:number;type:string;label:string;config:Record<string,unknown>};

export function flowChoiceValues(value:unknown):string[] {
 if(typeof value!=='string'||value.length>10000)
  throw new Error('Choice Set must contain bounded text choices');
 const choices=value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
 if(!choices.length||choices.length>100||choices.some(item=>item.length>255)
  ||new Set(choices).size!==choices.length)
  throw new Error('Choice Set requires 1–100 unique choices of at most 255 characters');
 return choices;
}
export function hydrateFlowScreenChoices(screen:Screen,resources:FlowChoiceResource[]):Screen {
 if(screen.type!=='Screen')return screen;
 const fields=Array.isArray(screen.config.fields)?screen.config.fields:[];
 const hydrated=fields.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
  const field=raw as Record<string,unknown>;
  if(!field.choiceSetResource)return field;
  if(field.type!=='Picklist')throw new Error('Choice Sets currently support Picklist fields');
  const resource=resources.find(item=>item.name===field.choiceSetResource
    &&item.type==='Choice Set');
  if(!resource)throw new Error('Screen Choice Set resource is unavailable');
  return {...field,choices:flowChoiceValues(resource.value)};
 });
 return {...screen,config:{...screen.config,fields:hydrated}};
}
