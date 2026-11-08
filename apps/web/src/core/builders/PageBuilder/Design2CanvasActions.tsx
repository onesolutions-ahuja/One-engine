import {
 AlignHorizontalJustifyStart,AlignHorizontalJustifyCenter,AlignHorizontalJustifyEnd,
 AlignVerticalJustifyStart,AlignVerticalJustifyCenter,AlignVerticalJustifyEnd,
 ArrowLeftRight,ArrowUpDown,Layers3,ArrowDown,Group,Ungroup,Lock,Unlock,Boxes,Maximize
} from 'lucide-react';
import type {ArrangeRibbonProps} from './ArrangeRibbon';

type Props={area:string;arrange?:ArrangeRibbonProps;section?:'dimensions'|'alignment'|'arrangement'};

/** Row 0 C7-C21: fixed, always-present canvas commands.
 * The Arrange ribbon's existing Page Builder callbacks remain the single
 * implementation of every operation. Only the Body area enables actions.
 * A command that cannot apply to the current selection stays visible/disabled.
 */
export default function Design2CanvasActions(props:Props){
 const body=props.area==='Body';
 const arrange=props.arrange;
 const movable=body&&arrange?.freeCanvas&&arrange?.hasSelection&&!arrange?.locked;
 const hasThree=body&&arrange?.freeCanvas&&(arrange?.selectedCount??0)>=3;
 const actions=[
  {label:'Align left',Icon:AlignHorizontalJustifyStart,enabled:movable,
   action:()=>arrange?.onAlign('x','start')},
  {label:'Align centre',Icon:AlignHorizontalJustifyCenter,enabled:movable,
   action:()=>arrange?.onAlign('x','center')},
  {label:'Align right',Icon:AlignHorizontalJustifyEnd,enabled:movable,
   action:()=>arrange?.onAlign('x','end')},
  {label:'Align top',Icon:AlignVerticalJustifyStart,enabled:movable,
   action:()=>arrange?.onAlign('y','start')},
  {label:'Align middle',Icon:AlignVerticalJustifyCenter,enabled:movable,
   action:()=>arrange?.onAlign('y','center')},
  {label:'Align bottom',Icon:AlignVerticalJustifyEnd,enabled:movable,
   action:()=>arrange?.onAlign('y','end')},
  {label:'Distribute horizontally',Icon:ArrowLeftRight,enabled:hasThree,
   action:()=>arrange?.onDistribute('x')},
  {label:'Distribute vertically',Icon:ArrowUpDown,enabled:hasThree,
   action:()=>arrange?.onDistribute('y')},
  {label:'Bring to front',Icon:Layers3,enabled:movable&&arrange?.canBringToFront,
   action:()=>arrange?.onPlace('front')},
  {label:'Send backward',Icon:ArrowDown,enabled:movable&&arrange?.canSendBackward,
   action:()=>arrange?.onMove(-1)},
  {label:'Group',Icon:Group,enabled:body&&arrange?.freeCanvas&&arrange?.canGroup,
   action:()=>arrange?.onGroup()},
  {label:'Ungroup',Icon:Ungroup,enabled:body&&arrange?.freeCanvas&&arrange?.canUngroup,
   action:()=>arrange?.onUngroup()},
  {label:arrange?.locked?'Unlock component':'Lock / Unlock component',Icon:arrange?.locked?Unlock:Lock,
   enabled:body&&arrange?.freeCanvas&&arrange?.hasSelection,action:()=>arrange?.onLock()},
  {label:'Component nesting',Icon:Boxes,enabled:body&&arrange?.hasSelection,
   action:()=>arrange?.onNesting()},
  {label:'Fill canvas',Icon:Maximize,enabled:movable&&arrange?.canFitToCanvas,
   action:()=>arrange?.onFitToCanvas()}
 ];
 const indices=props.section==='alignment'?[0,1,2,3,4,5]:
  props.section==='arrangement'?[6,7,8,9,10,11]:
  props.section==='dimensions'?[12,13,14]:actions.map((_,i)=>i);
 return <div className="smart-design2-arrange-actions"
   data-design-section={props.section??'all'}
   role="group" aria-label={props.section==='alignment'?'Alignment':
    props.section==='arrangement'?'Arrangement':
    props.section==='dimensions'?'Dimension actions':'Design 2 canvas actions'}
   data-design-columns="7-21">
   {indices.map(index=>{const item=actions[index];return <button key={index} type="button"
     className="smart-design2-arrange-action"
     data-design-row="0" data-design-column={index+7}
     data-supported={item.enabled?'true':'false'}
     title={item.label} aria-label={item.label}
     aria-pressed={index===12?arrange?.locked:undefined}
     disabled={!item.enabled} onClick={item.action}>
     <item.Icon size={16} aria-hidden="true"/>
   </button>;})}
 </div>;
}
