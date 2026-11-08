import {AlignHorizontalJustifyStart,AlignHorizontalJustifyCenter,AlignHorizontalJustifyEnd,
 AlignVerticalJustifyStart,AlignVerticalJustifyCenter,AlignVerticalJustifyEnd,
 ArrowLeftRight,ArrowUpDown,ArrowDown,Layers3,Group,Ungroup,Lock,Unlock,Boxes,Maximize} from 'lucide-react';
import './ArrangeRibbon.css';

type Axis='x'|'y';
type Anchor='start'|'center'|'end';
export type ArrangeRibbonProps={
 freeCanvas:boolean;hasSelection:boolean;locked:boolean;selectedCount:number;
 canGroup:boolean;canUngroup:boolean;
 canBringToFront:boolean;canSendBackward:boolean;canFitToCanvas:boolean;
 onAlign:(axis:Axis,anchor:Anchor)=>void;onDistribute:(axis:Axis)=>void;
 onMove:(offset:-1|1)=>void;onPlace:(edge:'front'|'back')=>void;
 onGroup:()=>void;onUngroup:()=>void;onLock:()=>void;onNesting:()=>void;onFitToCanvas:()=>void;
};
/** Pure presentation: the existing page-builder handlers own every command. */
export default function ArrangeRibbon(props:ArrangeRibbonProps){
 const allowed=props.freeCanvas&&props.hasSelection&&!props.locked;
 const groups=[
  {name:'Align',rows:[
   [{label:'Align left',icon:AlignHorizontalJustifyStart,disabled:!allowed,run:()=>props.onAlign('x','start')},
    {label:'Align centre',icon:AlignHorizontalJustifyCenter,disabled:!allowed,run:()=>props.onAlign('x','center')},
    {label:'Align right',icon:AlignHorizontalJustifyEnd,disabled:!allowed,run:()=>props.onAlign('x','end')}],
   [{label:'Align top',icon:AlignVerticalJustifyStart,disabled:!allowed,run:()=>props.onAlign('y','start')},
    {label:'Align middle',icon:AlignVerticalJustifyCenter,disabled:!allowed,run:()=>props.onAlign('y','center')},
    {label:'Align bottom',icon:AlignVerticalJustifyEnd,disabled:!allowed,run:()=>props.onAlign('y','end')}]]},
  {name:'Distribute',rows:[
   [{label:'Distribute horizontally',icon:ArrowLeftRight,disabled:!props.freeCanvas||props.selectedCount<3,run:()=>props.onDistribute('x')}],
   [{label:'Distribute vertically',icon:ArrowUpDown,disabled:!props.freeCanvas||props.selectedCount<3,run:()=>props.onDistribute('y')}]]},
  {name:'Order',rows:[
   [{label:'Bring to front',icon:Layers3,disabled:!allowed||!props.canBringToFront,run:()=>props.onPlace('front')}],
   [{label:'Send backward',icon:ArrowDown,disabled:!allowed||!props.canSendBackward,run:()=>props.onMove(-1)}]]},
  {name:'Group',rows:[
   [{label:'Group',icon:Group,disabled:!props.freeCanvas||!props.canGroup,run:props.onGroup},
    {label:'Ungroup',icon:Ungroup,disabled:!props.freeCanvas||!props.canUngroup,run:props.onUngroup}],
   [{label:props.locked?'Unlock component':'Lock component',icon:props.locked?Unlock:Lock,
     disabled:!props.freeCanvas||!props.hasSelection,run:props.onLock},
    {label:'Component nesting',icon:Boxes,disabled:!props.hasSelection,run:props.onNesting},
     {label:'Fill canvas',icon:Maximize,disabled:!allowed||!props.canFitToCanvas,run:props.onFitToCanvas}]]}
 ];
 return <div className="arrange-ribbon" aria-label="Arrange components">
  {groups.map(group=><section key={group.name} className="arrange-ribbon-group" aria-label={group.name}>
   <div className="arrange-ribbon-rows">{group.rows.map((row,i)=><div key={i} className="arrange-ribbon-row">
    {row.map(button=><button key={button.label} type="button" title={button.label}
     aria-label={button.label} disabled={button.disabled} onClick={button.run}>
     <button.icon size={16} aria-hidden="true"/>
    </button>)}
   </div>)}</div><span className="arrange-ribbon-caption">{group.name}</span>
  </section>)}
 </div>;
}
