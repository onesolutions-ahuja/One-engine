import type {ReactNode} from 'react';
import {Workflow, Smartphone, Boxes, ListChecks, ShieldCheck, SlidersHorizontal} from 'lucide-react';
import './PageBuilderAdvancedRibbon.css';

export type AdvancedFeature =
  | 'responsive' | 'nesting'
  | 'recordPage' | 'assignments' | 'properties';

type Feature={key:AdvancedFeature;label:string;hint:string;scope:'component'|'record'|'page';icon:typeof Workflow};
const groups: Array<{label:string;features:Feature[]}> = [
  {label:'Component',features:[
    {key:'responsive',label:'Responsive settings',hint:'Edit the active device layout and component responsive properties',scope:'component',icon:Smartphone},
    {key:'nesting',label:'Component nesting',hint:'Set the parent container and configure nested blocks',scope:'component',icon:Boxes},
    {key:'properties',label:'Advanced properties',hint:'Open all existing component configuration controls',scope:'component',icon:SlidersHorizontal}
  ]},
  {label:'Page',features:[
    {key:'recordPage',label:'Record page settings',hint:'Dynamic Forms, related lists, record buttons and links',scope:'record',icon:ListChecks},
    {key:'assignments',label:'Activation assignments',hint:'Choose where record and home pages appear',scope:'page',icon:ShieldCheck}
  ]}
];
export const advancedFeatureLabels:Record<AdvancedFeature,string>=Object.fromEntries(
  groups.flatMap(group=>group.features.map(feature=>[feature.key,feature.label]))
) as Record<AdvancedFeature,string>;

export default function PageBuilderAdvancedRibbon({selected,recordPage,onOpen,canvasTools}:{
  selected:boolean;recordPage:boolean;onOpen:(feature:AdvancedFeature)=>void;canvasTools?:ReactNode;
}){
  return <div className="page-builder-advanced-ribbon" aria-label="Advanced Page Builder tools">
    {groups.map(group=><section key={group.label} className="page-builder-advanced-group">
      <div className="page-builder-advanced-buttons">
        {group.features.map(feature=>{
          const disabled=feature.scope==='component'&&!selected
            ||feature.scope==='record'&&!recordPage;
          const Icon=feature.icon;
          return <button key={feature.key} type="button" disabled={disabled}
            aria-label={feature.label} title={disabled
              ?feature.scope==='record'?'Available on Record Pages only'
                :'Select a component first'
              :feature.hint}
            onClick={()=>onOpen(feature.key)}><Icon size={15} aria-hidden="true"/>
            <span>{feature.label}</span></button>;
        })}
      </div><span className="page-builder-advanced-heading">{group.label}</span>
    </section>)}
    {canvasTools && <section className="page-builder-advanced-group page-builder-canvas-ribbon-group" aria-label="Canvas tools">
      <div className="page-builder-advanced-buttons page-builder-canvas-ribbon-buttons">{canvasTools}</div>
      <span className="page-builder-advanced-heading">Canvas tools</span>
    </section>}
  </div>;
}
