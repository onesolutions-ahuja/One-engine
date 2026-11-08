import type {AppPageSeed} from '../system-support/app-page-seeder.js';
/** Independent conversation app package. Installation supplies metadata selected
 * by label; no Object/Field/Flow API name is embedded in reusable components. */
export type ConversationSeed = {
  pageApiName:string;title:string;componentId:string;objectId:string;contactObjectId?:string;
  sendFlowId:string;assignFlowId?:string;
  fields:Record<string,string>;incomingValue:string;outgoingValue:string;
  channelAccessPath:string;
  sendInputs:Record<string,string>;assignInputs?:Record<string,string>;
};
const ref=(id:string)=>'metadata:'+id;
export function conversationPageSeed(config:ConversationSeed):AppPageSeed {
  const required=['direction','account','from','to','occurred','body'];
  if(!config||!config.objectId||!config.sendFlowId||required.some(role=>!config.fields?.[role])
    ||!config.incomingValue||!config.outgoingValue||config.incomingValue===config.outgoingValue)
    throw new Error('Conversation app dependencies and field mappings must be selected');
  if(!/^\/[A-Za-z0-9/_-]+$/.test(config.channelAccessPath))throw new Error('Invalid channel permission endpoint');
  const fields=Object.fromEntries(Object.entries(config.fields).map(([role,id])=>[
    'conversation'+role[0].toUpperCase()+role.slice(1)+'FieldApiName',ref(id)]));
  return {key:'conversation',version:1,pageApiName:config.pageApiName,title:config.title,componentId:config.componentId,
    properties:{title:config.title,viewMode:'inbox',objectApiName:ref(config.objectId),
      ...(config.contactObjectId?{contactsObjectApiName:ref(config.contactObjectId)}:{}),
      recordPresenterApiName:'ConversationThread',channelAccessPath:config.channelAccessPath,
      liveRefreshEnabled:true,restrictToAssigned:true,enableAssignment:Boolean(config.assignFlowId),
      conversationIncomingValue:config.incomingValue,conversationOutgoingValue:config.outgoingValue,...fields,
      actionFlows:{send:{flowApiName:ref(config.sendFlowId),inputs:config.sendInputs},
        ...(config.assignFlowId?{assign:{flowApiName:ref(config.assignFlowId),inputs:config.assignInputs??{}}}:{})}}};
}
