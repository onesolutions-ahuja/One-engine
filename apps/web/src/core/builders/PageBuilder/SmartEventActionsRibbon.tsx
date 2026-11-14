import type {FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';

type Binding=Record<string,unknown>;
type Actions=Record<string,unknown>;
const clickComponents=new Set(['smart_button','smart_toggle','smart_calendar','smart_cart','smart_card_grid','smart_numpad',
 'smart_keyboard','smart_dock']);
const selectComponents=new Set(['smart_lookup']);
const changeComponents=new Set(['smart_calendar','smart_lookup','smart_selector','smart_tabs','smart_toggle','smart_text','smart_card_grid','smart_numpad',
 'smart_keyboard']);
/** Smart Dock: one independent event per item, shown under Other events. */
export const dockItemEvents=['dockItem1','dockItem2','dockItem3','dockItem4','dockItem5','dockItem6',
 'dockItem7','dockItem8','dockItem9','dockItem10','dockItem11','dockItem12'] as const;
/** Component event applicability is shared by the old property contract and unified catalog. */
export const supportsSmartActionEvent=(api:string,event:string):boolean=>
 event==='click'?clickComponents.has(api):
 event==='change'?changeComponents.has(api):
 event==='select'?selectComponents.has(api):
 event==='start'?api.startsWith('smart_'):
 ['qtyIcon','qtyIncrease','qtyDecrease'].includes(event)?api==='smart_cart':
 ['customButton1','customButton2'].includes(event)?['smart_cart','smart_card_grid','smart_numpad'].includes(api):
 event==='customButton3'||event==='clear'||event==='backspace'?api==='smart_numpad':
 event==='dismiss'?api==='smart_keyboard':
 (dockItemEvents as readonly string[]).includes(event)?api==='smart_dock':false;

const asObject=(value:unknown):Binding=>
 value&&typeof value==='object'&&!Array.isArray(value)?value as Binding:{};

/** Shared Actions slots: unsupported component properties remain visible and disabled. */
export default function SmartEventActionsRibbon({api,actions,flows,onChange,selectedApis,mixedSlots}:{
 api:string;actions:Actions;flows:FlowDefinitionMetadata[];onChange:(value:Actions)=>void;
 selectedApis?:readonly string[];mixedSlots?:readonly string[];
}){
 const members=selectedApis?.length?selectedApis:[api];
 const slots=[
  {key:'click',label:'On Click',enabled:members.every(member=>clickComponents.has(member))},
  {key:'change',label:'On Change',enabled:members.every(member=>changeComponents.has(member))},
  {key:'select',label:'On Select',enabled:members.every(member=>selectComponents.has(member))},
  // Page Runtime invokes the metadata start action once per page session.
  // It is not a Smart JSX event and remains disabled in read-only Builder previews.
  {key:'start',label:'On Session Start',enabled:members.every(member=>member.startsWith('smart_'))}
 ];
 const qtySlot={key:'qtyIcon',label:'Qty icon',enabled:members.every(member=>member==='smart_cart')};
 const customSlots=[
  {key:'customButton1',label:'Custom Button 1',enabled:['smart_cart','smart_card_grid','smart_numpad'].includes(api)},
  {key:'customButton2',label:'Custom Button 2',enabled:['smart_cart','smart_card_grid','smart_numpad'].includes(api)},
  {key:'customButton3',label:'Custom Button 3',enabled:api==='smart_numpad'}
 ];
 const active=flows.filter(flow=>flow.status==='Active'&&
  (flow.flowType==='Autolaunched Flow'||flow.flowType==='Screen Flow'||flow.flowType==='In-Screen Flow'));
 const update=(event:string,flowName:string)=>{
  const next={...actions};
  if(!flowName){delete next[event];onChange(next);return;}
  const flow=active.find(item=>item.apiName===flowName);
  if(!flow)return;
  const previous=asObject(actions[event]);
  next[event]={...previous,actionType:'Flow',flowApiName:flow.apiName,flowType:flow.flowType,
   inputs:asObject(previous.inputs)};
  onChange(next);
 };
 const picker=(slot:{key:string;label:string;enabled:boolean})=>{
  const saved=asObject(actions[slot.key]);
  const adjusted=slot.enabled&&!mixedSlots?.includes(slot.key)&&saved.actionType==='AdjustNumber';
  const selected=adjusted?'__adjust_number__':slot.enabled&&!mixedSlots?.includes(slot.key)&&
    !['Navigate','PageState','SetFilter','AdjustNumber'].includes(String(saved.actionType))
    ?String(saved.flowApiName??''):'';
  return <label key={slot.key} className="smart-event-picker">
    <span>{slot.label}</span>
    <select aria-label={slot.label+' flow'} disabled={!slot.enabled}
      title={!slot.enabled?'Not supported by selected component':'Select Autolaunched or Screen Flow'}
      value={selected} onChange={event=>update(slot.key,event.target.value)}>
      <option value="">Select Flow…</option>
      {adjusted&&<option value="__adjust_number__" disabled>Change number (+/−) — use Component Action ribbon</option>}
      {selected&&!active.some(flow=>flow.apiName===selected)&&
        <option value={selected}>{selected} (saved/inactive)</option>}
      {(['Autolaunched Flow','Screen Flow','In-Screen Flow'] as const).map(kind=>
        <optgroup key={kind} label={kind}>
          {active.filter(flow=>flow.flowType===kind).map(flow=>
            <option key={flow.apiName} value={flow.apiName}>{flow.label}</option>)}
        </optgroup>)}
    </select>
  </label>;
 };
 return <div className="office-ribbon-compact-strip smart-event-actions-ribbon"
   aria-label="Smart component event properties">
   <section className="office-ribbon-mini-group smart-event-group" aria-label="Events">
     <div className="smart-event-rows">{slots.map(picker)}</div>
     <span className="office-ribbon-group-heading">Events</span>
   </section>
   <section className="office-ribbon-mini-group smart-event-group" aria-label="Cart">
     <div className="smart-event-rows">{picker(qtySlot)}</div>
     <span className="office-ribbon-group-heading">Cart</span>
   </section>
   {(['smart_cart','smart_card_grid'].includes(api)||api==='smart_numpad')&&<section className="office-ribbon-mini-group smart-event-group" aria-label="Component Custom">
     <div className="smart-event-rows">{customSlots.map(picker)}</div>
     <span className="office-ribbon-group-heading">Component Custom</span>
   </section>}
 </div>;
}
