import {template,type ActionContext} from './ActionNodeShared.js';
import {persistPlatformEvent} from '../platform-event-runtime.js';
export async function executePlatformEventPublishNode(context:ActionContext) {
 const eventApi=context.config.eventApiName;
 const mappings=context.config.fieldValues;
 if(typeof eventApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(eventApi)
   ||!Array.isArray(mappings)||mappings.length>100)
  throw new Error('Invalid Publish Platform Event configuration');
 const values:Record<string,unknown>={};
 for(const mapping of mappings){
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))
   throw new Error('Invalid Platform Event field mapping');
  const item=mapping as Record<string,unknown>,field=item.field;
  if(typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)
   ||Object.hasOwn(values,field))throw new Error('Invalid Platform Event field mapping');
  values[field]=template(item.value,context.resolve);
 }
 await persistPlatformEvent(context.client,context.rbac,context.tenantId,context.userId,eventApi,values);
}

