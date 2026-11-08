import {useMemo,useState} from 'react';
import {auditUniversalRibbonCoverage} from './universalRibbonCoverage.mjs';
import {createPortal} from 'react-dom';
import RibbonColorPalette from './RibbonColorPalette';
import BuilderNumberInput from './BuilderNumberInput';
import type {LibraryComponentMetadata,ObjectMetadata,FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';
import CustomComponentPropertyEditor from '../ComponentProperties/CustomComponentPropertyEditor';
import {metadataFieldObject,metadataSelection,metadataReference} from '../../metadata/Definitions/metadataReferences';
import TenantMediaPicker from '../ComponentProperties/TenantMediaPicker';

/**
 * Universal Page Builder ribbon inventory. Importing metadata eagerly is confined to
 * the lazy-loaded builder; published app runtimes never import this catalog.
 * Fixed property slots for every Smart component; unsupported controls stay visible and disabled.
 */
type Definition=NonNullable<LibraryComponentMetadata['propertyDefinitions']>[number];
type Properties=Record<string,unknown>;
type CatalogComponent={apiName:string;propertyDefinitions?:Definition[]};
type Tab='Component Data'|'Component Content'|'Component Properties'|'Component Layout'|'Component Responsive'|'Component Action';
const manifests=Object.values(import.meta.glob('../../../component-libraries/*/component.json',{eager:true,import:'default'})) as CatalogComponent[];
const validManifests=manifests.filter(item=>/^smart_[a-z0-9_]+$/.test(item.apiName));
const definitionMap=new Map<string,Definition>();
for(const component of validManifests){
  for(const def of component.propertyDefinitions??[]){
    if(!definitionMap.has(def.propertyKey))definitionMap.set(def.propertyKey,def);
  }
}
// Every active property in any Smart manifest gets one permanent slot in the
// universal ribbon. Component selection only changes enabled/disabled state.
// A property retired from one component remains as a disabled slot if another
// component still declares it. No component-specific filtering is permitted.
const excluded=new Set<string>();
const sections:Record<Tab,readonly string[]>={
  'Component Data':['Source','Fields','Filters','Records','Data integration','Values'],
  'Component Content':['Text','Image','Options','Content fields','Component content'],
  'Component Properties':['Surface','Card','Heading','Supporting text','Badge','Image','Appearance','Additional styling'],
  'Component Layout':['Size','Position','Spacing','Container','Nesting','Arrangement','Tabs','Header','Image'],
  'Component Responsive':['Device','Responsive layout','Visibility','Mobile behaviour'],
  'Component Action':['Events','Actions','Flows','Navigation','Conditions','Mappings']
};
function place(key:string):[Tab,string]{
  // Explicit Page Builder section destinations take precedence over generic rules.
  if(key==='imagePlacement')return ['Component Properties','Image'];
  if(key==='label'||key==='defaultValue')return ['Component Data','Values'];
  if(key==='tabHeight'||key==='tabWidth')return ['Component Layout','Tabs'];
  if(key==='headerBoxHeight')return ['Component Layout','Header'];
  if(key==='imageHeight')return ['Component Layout','Image'];
  if(/(?:^|_)(?:event|flow|action|operation|checkout|send|stateSync|stateRead|stateWrite|stateKey|stateValue|stateVersion|stateRecord|statePoll|stateSession)|(?:Output|Input)$|^canSend$|^enableSendPreparation$|^requirePerRecordSendGrant$/i.test(key))
    return ['Component Action', /flow|state|output|input/i.test(key)?'Flows':/event/i.test(key)?'Events':/checkout|send|action|operation/i.test(key)?'Actions':'Conditions'];
  if(/(?:mobile|phone|tablet|desktop|responsive|keyboard|fullScreen|device|autoScroll|threshold|showNewMessageNotice|avoidKeyboard)/i.test(key))
    return ['Component Responsive',/mobile|phone|keyboard/i.test(key)?'Mobile behaviour':'Responsive layout'];
  if(/^(?:width|height|imageHeight|imageWidth|cardWidth|cardMinHeight|productCardMinWidth|catalogueWidthPercent)$/i.test(key))
    return ['Component Layout','Size'];
  if(/(?:padding|margin|gap|density|columns|rows|span|ratio|position|direction|wrap|layoutContainer|splitRatio|corner|xOffset|yOffset)/i.test(key))
    return ['Component Layout',/padding|margin|gap|density/i.test(key)?'Spacing':/position|offset/i.test(key)?'Position':/layoutContainer/i.test(key)?'Nesting':'Container'];
  if(key==='surface')return ['Component Properties','Surface'];
  if(/^(theme|tone|accentColor|glassBlur)$/.test(key))return ['Component Properties','Appearance'];
  if(/^(?:backgroundColor|borderColor|textColor|radius|shadow|opacity)$/.test(key))return ['Component Properties','Surface'];
  if(/^card(?:Background|Border|Radius|Shadow|Hover|Density)/.test(key))return ['Component Properties','Card'];
  if(/^heading(?:Font|Color|Text|Line)/.test(key))return ['Component Properties','Heading'];
  if(/^description(?:Font|Color|Text|Line)/.test(key))return ['Component Properties','Supporting text'];
  if(/^badge(?:Font|Text|Background)/.test(key))return ['Component Properties','Badge'];
  if(/^image(?:Fit|Shape|Aspect|Position)/.test(key))return ['Component Properties','Image'];
  if(/(?:fontSize|fontWeight|fontColor|letterSpacing|borderWidth|borderStyle)/i.test(key))return ['Component Properties','Additional styling'];
  if(/(?:objectApiName|sourceObject|recordPresenter|conversationsObject|messagesObject|contactsObject|channelAccountObject|contactSourceObject)/i.test(key))return ['Component Data','Source'];
  if(/(?:fieldApiName|FieldApiNames|fieldMapping|column|mapping)/i.test(key))
    return ['Component Data',/filter/i.test(key)?'Filters':'Fields'];
  if(/(?:filter|searchKey|searchTerm|searchField|searchMode|selectedCategory|selectionFilter|restrictToAssigned)/i.test(key))return ['Component Data','Filters'];
  if(/(?:record|loading|items|pageSize|maxItems|sort|selectedValue)/i.test(key))return ['Component Data','Records'];
  if(/(?:src|imageSrc|imageExpression|alt|caption|missingImage)/i.test(key))return ['Component Content','Image'];
  if(key==='value')return ['Component Content','Text'];
  if(key==='allowTyping')return ['Component Content','Options'];
  if(/(?:placeholder|label|title|subtitle|description|text|empty|message|helpText|buttonLabel|notice)/i.test(key))return ['Component Content','Text'];
  if(/(?:options|choices|groups|selectedIndex|viewMode|mode|variant|severity|show|required|disabled|enable|controlled)/i.test(key))return ['Component Content','Options'];
  return ['Component Content','Component content'];
}
const slots=new Map<Tab,Map<string,Definition[]>>();
for(const tab of Object.keys(sections) as Tab[])slots.set(tab,new Map(sections[tab].map(section=>[section,[]])));
for(const [key,definition] of definitionMap){
  if(excluded.has(key))continue;
  const [tab,section]=place(key);
  slots.get(tab)?.get(section)?.push(definition);
}
for(const groups of slots.values())for(const defs of groups.values())defs.sort((a,b)=>a.propertyKey.localeCompare(b.propertyKey));
export const universalRibbonCoverage=auditUniversalRibbonCoverage(
  validManifests,
  Array.from(slots.values()).flatMap(groups=>Array.from(groups.values()).flatMap(defs=>defs.map(def=>def.propertyKey))),
  [...excluded]
);
if(import.meta.env.DEV&&(universalRibbonCoverage.missing.length||universalRibbonCoverage.duplicates.length))
  throw new Error('Smart ribbon registry coverage failed: '+JSON.stringify(universalRibbonCoverage));
export const universalRibbonInventoryCount=Array.from(slots.values()).reduce((total,groups)=>total+Array.from(groups.values()).reduce((sum,defs)=>sum+defs.length,0),0);
export const universalRibbonComponentCount=validManifests.length;

// Include additional active SQL/library-defined Smart properties in the SAME
// shared inventory. The complete catalog is passed for every component; never
// derive the layout from just the selected component's property definitions.
function mergeCatalogSlots(tab:Tab,catalog:readonly LibraryComponentMetadata[]):Map<string,Definition[]>{
 const baseline=slots.get(tab);
 const result=new Map<string,Definition[]>(Array.from(baseline??[],([section,defs]):[string,Definition[]]=>[section,[...defs]]));
 const known=new Set(definitionMap.keys());
 for(const component of catalog){
   if(!/^smart_[a-z0-9_]+$/.test(component.apiName))continue;
   for(const def of component.propertyDefinitions??[]){
     if(known.has(def.propertyKey))continue;
     known.add(def.propertyKey);
     const [target,section]=place(def.propertyKey);
     if(target===tab)result.get(section)?.push(def);
   }
 }
 for(const defs of result.values())defs.sort((a,b)=>a.propertyKey.localeCompare(b.propertyKey));
 return result;
}


function PropertyEditor({definition,enabled,reviewOnly=false,properties,onChange,objects,flows,onOpenComplex,complexSelected}:{
 definition:Definition;enabled:boolean;reviewOnly?:boolean;properties:Properties;onChange:(next:Properties)=>void;
 objects:readonly ObjectMetadata[];flows:readonly FlowDefinitionMetadata[];
 onOpenComplex?:(key:string)=>void;complexSelected?:boolean;
}){
 const [mediaOpen,setMediaOpen]=useState(false);
 const [jsonError,setJsonError]=useState('');
 const key=definition.propertyKey;
 const label=definition.label||key.replace(/([a-z])([A-Z])/g,'$1 $2');
 const unitMatch=/^(.*?)\s*\((px|%|ms|s|columns|rows|lines|deg)\)\s*$/i.exec(label);
 const unit=(definition.kind==='NUMBER'||definition.kind==='CURRENCY')&&unitMatch?unitMatch[2]:'';
 const shownLabel=unit&&unitMatch?unitMatch[1]:label;
 const value=properties[key]??definition.defaultValue??'';
 const update=(next:unknown)=>{if(enabled)onChange({...properties,[key]:next});};
 const tip=reviewOnly?label+' — review only; not saved for this component':enabled?label:'Not supported by selected component';
 const props={disabled:!enabled,title:tip,'aria-label':label};
 let editor;
 if(definition.kind==='BOOLEAN')editor=<input type="checkbox" {...props} checked={value===true} onChange={e=>update(e.target.checked)}/>;
 else if(definition.kind==='SELECT')editor=<select {...props} value={String(value)} onChange={e=>update(e.target.value)}>
   <option value="">Default</option>{(definition.choices??[]).map(choice=><option key={choice.key} value={choice.key}>{choice.label}</option>)}
 </select>;
 else if(definition.kind==='NUMBER'||definition.kind==='CURRENCY'){
   const field=<BuilderNumberInput {...props} key={key}
     min={definition.min} max={definition.max}
     value={typeof value==='number'?value:''} onValueChange={update}/>;
   editor=unit?<span className="smart-unit-field" data-unit={unit}>{field}</span>:field;
 }
 else if(definition.kind==='IMAGE')editor=<><button type="button" disabled={!enabled} title={tip} onClick={()=>setMediaOpen(true)}>Choose / Upload</button>
   {mediaOpen&&createPortal(<div className="smart-universal-media-overlay" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target)setMediaOpen(false);}}>
      <div role="dialog" aria-modal="true" aria-label={label+' media library'}><button type="button" onClick={()=>setMediaOpen(false)}>Close</button>
        <TenantMediaPicker assetOnly initiallyOpen value={String(value)} onChange={next=>{update(next);setMediaOpen(false);}}/>
      </div></div>,document.body)}</>;
 else if(definition.kind==='OBJECT'){
   editor=<select {...props} value={metadataSelection(objects,value)?.apiName??String(value??'')}
     onChange={e=>{const selected=objects.find(item=>item.apiName===e.target.value);update(selected?.id?metadataReference(selected.id):e.target.value);}}>
     <option value="">Select object…</option>{objects.map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
   </select>;
 }
 else if(definition.kind==='OBJECT_FIELD'){
   const source=metadataFieldObject(objects,{...properties,objectApiName:properties.objectApiName??''},key);
   editor=<select {...props} value={String(value??'')} onChange={e=>update(e.target.value)}>
     <option value="">Select field…</option>
     {value!==undefined&&String(value)!==''&&!source?.fields?.some(f=>f.apiName===String(value))&&<option value={String(value)}>{String(value)} (saved)</option>}
     {(source?.fields??[]).map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
   </select>;
 }
 else if(!['BOOLEAN','SELECT','NUMBER','CURRENCY','IMAGE','COLOR','TEXT','LONG_TEXT','TEXTAREA','STRING'].includes(definition.kind)){
   // Inline native editor; no Configure/Editing state and no additional ribbon section.
   editor=<div className="smart-universal-inline-complex" onClick={e=>e.stopPropagation()}>
     <CustomComponentPropertyEditor definitions={[definition]} properties={{[key]:value}}
       objects={objects} flows={flows} primaryObjectApiName={String(properties.objectApiName??'')}
       disabled={!enabled} onChange={next=>update(next[key])}/>
   </div>;
 }
 else if(definition.kind==='COLOR'){
   const hex=/^#[0-9a-f]{6}$/i.test(String(value))?String(value):String(value).startsWith('#')||value==='transparent'?String(value):'';
   const kind=/border/i.test(key)?'border':/text|font|heading|description|supporting|value|icon/i.test(key)&&!/background/i.test(key)?'text':'fill';
   editor=<RibbonColorPalette variant="property" kind={kind} label={label} value={hex} disabled={!enabled} onChange={next=>update(next===''?undefined:next)}/>;
 }
 else if(value!==null&&typeof value==='object')editor=<textarea {...props} rows={1} value={JSON.stringify(value)}
   aria-invalid={!!jsonError} onChange={e=>{try{const parsed:unknown=JSON.parse(e.target.value);if(parsed===null||typeof parsed!=='object')throw Error('Expected an object or array');setJsonError('');update(parsed);}catch{setJsonError('Invalid structured value');}}}/>;
 else editor=<input {...props} type="text" value={String(value)} onChange={e=>update(e.target.value)}/>;
 return <label className={'smart-universal-property'+(enabled?'':' is-disabled')+(reviewOnly?' is-review-only':'')} title={tip} data-property={key} data-kind={definition.kind}>
   <span className="smart-universal-property-label" title={label}>{shownLabel}</span>
   {editor}
 </label>;
}
type CanvasPosition={x:number;y:number;width:number;height:number};
export type UniversalBuilderControls={
 position?:CanvasPosition;
 onPositionChange?:(position:CanvasPosition)=>void;
 visible:boolean;
 onVisibleChange:(visible:boolean)=>void;
 layoutMode:'template'|'free-canvas'|string;
 canvasWidth:number;
 canvasHeight:number;
 onOpenSource?:()=>void;
 onOpenFilters?:()=>void;
};
export default function UniversalRibbonInventory({tab,definition,componentId,properties,onChange,objects=[],flows=[],catalog=[],builder}:{
 tab:Tab;definition?:LibraryComponentMetadata;componentId?:string;properties:Properties;
 onChange:(next:Properties)=>void;
 objects?:readonly ObjectMetadata[];flows?:readonly FlowDefinitionMetadata[];
 catalog?:readonly LibraryComponentMetadata[];
 builder?:UniversalBuilderControls;
}){
 // Every component uses the same inventory, section order and control positions.
 const reviewPositionValue=(key:keyof CanvasPosition):number|string=>builder?.position?.[key]??'';
 const editCanvas=(key:keyof CanvasPosition,min:number,raw:string)=>{
   const value=Number(raw);
   if(!Number.isFinite(value)||value<min)return;
   if(builder?.position&&builder.layoutMode==='free-canvas')
     builder.onPositionChange?.({...builder.position,[key]:Math.round(value)});
 };
 const selectedDefinitions=new Map((definition?.propertyDefinitions??[]).map(item=>[item.propertyKey,item]));
 const enabled=new Set(selectedDefinitions.keys());
 const canEditCanvas=builder?.layoutMode==='free-canvas'&&Boolean(builder.position)&&Boolean(builder.onPositionChange);
 const groups=useMemo(()=>mergeCatalogSlots(tab,catalog),[tab,catalog]);
 if(!groups)return null;
 return <div className="smart-universal-ribbon" aria-label="Universal Smart property ribbon"
   data-component={definition?.apiName??'none'} data-component-id={componentId??'none'} data-inventory-count={universalRibbonInventoryCount}
   data-review-mode="all-disabled">
   {Array.from(groups).map(([section,defs])=><section key={section} className="smart-universal-ribbon-section" aria-label={section}>
     <h3 className="smart-universal-ribbon-section-heading" style={{display:"block",fontSize:12,fontWeight:700,margin:"0 0 8px",padding:"0 4px"}}>{section}</h3>
     <div className="smart-universal-ribbon-controls">
       {tab==='Component Layout'&&section==='Size'&&(['width','height'] as const).map(key=>
         <label key={'canvas-'+key} className="smart-universal-property" title={'Component '+key}>
           <span className="smart-universal-property-label">{key==='width'?'Width':'Height'}</span>
           <input aria-label={'Component '+key} type="number" min={1} disabled={!canEditCanvas} value={reviewPositionValue(key)}
             onChange={event=>editCanvas(key,1,event.target.value)}/>
         </label>)}
       {tab==='Component Layout'&&section==='Position'&&(['x','y'] as const).map(key=>
         <label key={'canvas-'+key} className="smart-universal-property" title={key.toUpperCase()+' position'}>
           <span className="smart-universal-property-label">{key.toUpperCase()} position</span>
           <input aria-label={key.toUpperCase()+' position'} type="number" min={0} disabled={!canEditCanvas}
             value={reviewPositionValue(key)}
             onChange={event=>editCanvas(key,0,event.target.value)}/>
         </label>)}
       {defs.map(def=>{
         const supported=enabled.has(def.propertyKey);
         const selectedDefinition=selectedDefinitions.get(def.propertyKey);
         // The slot's label, kind and position MUST NOT change when selection
         // changes. Runtime-specific options and defaults may change without
         // changing the visible ribbon layout.
         const controlDefinition=supported&&selectedDefinition
           ? {...def,choices:selectedDefinition.choices??def.choices,
               defaultValue:selectedDefinition.defaultValue??def.defaultValue}
           : def;
         return <PropertyEditor key={def.propertyKey}
           definition={controlDefinition}
           enabled={supported} properties={properties}
           onChange={next=>{
             if(supported)onChange({...properties,[def.propertyKey]:next[def.propertyKey]});
           }}
           objects={objects} flows={flows}
           />;
       })}
     </div>
   </section>)}

 </div>;
}
