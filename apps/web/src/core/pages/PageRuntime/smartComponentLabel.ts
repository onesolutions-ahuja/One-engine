/**
 * Caption passed to a component at runtime. Smart components use their own
 * "label" property. When none is set (for example an icon-only button), the
 * component's internal name such as "smart_button" must never be shown.
 */
export function runtimeComponentLabel(component:{type:string;label:string},labelProperty:unknown):string{
 if(!component.type.startsWith('Custom:smart_'))return component.label;
 if(typeof labelProperty==='string')return labelProperty;
 const typeName=component.type.slice('Custom:'.length);
 return component.label===typeName||component.label===component.type?'':component.label;
}
