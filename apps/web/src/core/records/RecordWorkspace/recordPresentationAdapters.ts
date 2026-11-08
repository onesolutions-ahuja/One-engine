import { buildChatterView, conversationField, type CommunicationRow } from './chatterRecordAdapter.js';

export type ChannelGrant = { channelAccountId: string; canRead: boolean; canSend: boolean; canAssign: boolean; viewAll?:boolean };
type PresentationContext = { grants: readonly ChannelGrant[]; userId: string; viewAll: boolean;
  eligibleAssignees?: readonly {id:string;name:string;channelAccountId:string}[] };
type Presenter = (records: readonly CommunicationRow[], context: PresentationContext, properties:Record<string,unknown>) => Record<string, unknown>;

function communicationThread(records: readonly CommunicationRow[], context: PresentationContext, properties:Record<string,unknown>): Record<string, unknown> {
  // Object rows have already passed server-side OneEngine object/field/record
  // authorisation. Write Flows still perform their own permission checks.
  if(properties.conversationAccessMode==='recordPermissions'){
    const model=buildChatterView(records,properties);
    const defaultAccount=typeof properties.conversationDefaultAccount==='string'
      ?properties.conversationDefaultAccount.trim():'';
    const accountIds=[...new Set([...model.conversations.map(row=>row.channelAccountId),
      ...(defaultAccount?[defaultAccount]:[])].filter(Boolean))];
    const sendEnabled=properties.sendEnabled===true;
    return {...model,
      conversations:model.conversations.map(row=>({...row,canSend:sendEnabled,canAssign:false})),
      currentUserId:context.userId,canViewAll:true,allowedAccountIds:accountIds,
      canSend:sendEnabled,eligibleAssignees:[],
      channelAccounts:accountIds.map(id=>({id,name:id,canSend:sendEnabled,canAssign:false}))};
  }
  const grants = new Map(context.grants.filter(grant=>grant.canRead).map(grant => [grant.channelAccountId, grant]));
  const visible = records.filter(row => grants.has(String(row[conversationField(properties,'account')] ?? '')));
  const model = buildChatterView(visible,properties);
  const conversations = model.conversations.map(chat => ({
    ...chat,
    canSend: grants.get(chat.channelAccountId)?.canSend === true,
    canAssign: grants.get(chat.channelAccountId)?.canAssign === true
  }));
  return {
    conversations, messages:model.messages, ...('accessError' in model?{accessError:model.accessError}:{}), currentUserId:context.userId,
    canViewAll:context.viewAll || context.grants.some(grant => grant.viewAll === true), allowedAccountIds:[...grants.keys()],
    canSend:[...grants.values()].some(grant=>grant.canSend),
    eligibleAssignees:context.eligibleAssignees??[],
    channelAccounts:[...grants].map(([id,grant])=>({id,name:id,canSend:grant.canSend,canAssign:grant.canAssign}))
  };
}
/** Extend via named metadata adapters, not per-component rendering code. */
const recordPresenters: Readonly<Record<string, Presenter>> = Object.freeze({
  ConversationThread: communicationThread,
  CommunicationThread: communicationThread // Compatibility key, not a separate engine.
});
export function presentPageRecords(apiName: unknown, records: readonly CommunicationRow[], context: PresentationContext, properties:Record<string,unknown>={}) {
  if (typeof apiName !== 'string' || !apiName) return {records};
  const presenter = recordPresenters[apiName];
  return presenter ? presenter(records, context,properties) : {records:[]};
}
