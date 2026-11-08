/** A metadata-configured conversation read model. Inputs must already be filtered
 * by tenant, object, field and record permissions; this function grants no access. */
export type CommunicationRow = Record<string, unknown>;
export type ChatterThread = { id:string; contactName:string; phoneNumber:string; channelAccountId:string;
  assignedUserId:string|null; preview:string; lastMessageAt:string; unreadCount:number };
export type ChatterMessage = { id:string; conversationId:string; direction:string; body:string;
  sentAt:string; status:string; mediaUrl:string; mediaName:string; mediaType:string };
const str=(v:unknown):string=>typeof v==='string'?v.trim():v==null?'':String(v);
export const conversationFieldRoles = ['direction','account','from','to','occurred','body','contactName',
  'assignedUser','readAt','status','mediaUrl','mediaName','mediaType'] as const;
export function conversationField(properties:Record<string,unknown>,role:string):string {
  return str(properties['conversation'+role[0].toUpperCase()+role.slice(1)+'FieldApiName']);
}
export function buildChatterView(rows:readonly CommunicationRow[],properties:Record<string,unknown>={}) {
  const field=(row:CommunicationRow,role:string)=>{
    const key=conversationField(properties,role);
    return key&&Object.hasOwn(row,key)?str(row[key]):'';
  };
  const incoming=str(properties.conversationIncomingValue),outgoing=str(properties.conversationOutgoingValue);
  const required=['direction','account','from','to','occurred','body'];
  if(!incoming||!outgoing||incoming===outgoing||required.some(role=>!conversationField(properties,role)))
    return {conversations:[],messages:[],accessError:'Configure conversation field mappings and direction values.'};
  const chats=new Map<string,ChatterThread>();
  const messages:ChatterMessage[]=[];
  for(const row of rows) {
    const direction=field(row,'direction');
    if(direction!==incoming&&direction!==outgoing)continue;
    const account=field(row,'account');
    const participant=field(row,direction===incoming?'from':'to');
    const phone=properties.conversationNormalizePhoneNumbers===true
      ?participant.replace(/\D/g,''):participant;
    if(!account||!phone||properties.conversationNormalizePhoneNumbers===true
      &&!/^[1-9][0-9]{6,14}$/.test(phone))continue;
    const key=JSON.stringify([account,phone]);
    const id=str(row.Id);if(!id)continue;
    const outgoingDateField=str(properties.conversationOutgoingOccurredFieldApiName);
    const occurred=direction===outgoing&&outgoingDateField
      ?str(row[outgoingDateField])||field(row,'occurred'):field(row,'occurred');
    const body=field(row,'body');
    const participantName=participant.match(/^(.*?)\s*\([^()]*\)\s*$/)?.[1]?.trim()||participant;
    const displayName=properties.conversationNameFromParticipant===true
      ?(participantName.replace(/\D/g,'')===phone?phone:participantName)
      :field(row,'contactName')||phone;
    const prior=chats.get(key);
    if(!prior)chats.set(key,{id:key,channelAccountId:account,contactName:displayName,
      phoneNumber:phone,assignedUserId:field(row,'assignedUser')||null,preview:body,
      lastMessageAt:occurred,unreadCount:0});
    const chat=chats.get(key)!;
    if(occurred>=chat.lastMessageAt){
      chat.preview=body;chat.lastMessageAt=occurred;
      if(displayName!==phone || !chat.contactName)chat.contactName=displayName;
      chat.assignedUserId=field(row,'assignedUser')||null;
    }
    if(direction===incoming&&conversationField(properties,'readAt')&&!field(row,'readAt'))chat.unreadCount++;
    messages.push({id,conversationId:key,direction:direction===incoming?'inbound':'outbound',body,sentAt:occurred,
      status:field(row,'status'),mediaUrl:field(row,'mediaUrl'),mediaName:field(row,'mediaName'),mediaType:field(row,'mediaType')});
  }
  messages.sort((a,b)=>a.sentAt.localeCompare(b.sentAt));
  return {conversations:[...chats.values()].sort((a,b)=>b.lastMessageAt.localeCompare(a.lastMessageAt)),messages};
}
