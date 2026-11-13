import {useState,useRef,useEffect,useLayoutEffect,type ChangeEvent,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {AlignLeft,AlignCenter,AlignRight,Bold,WrapText,ArrowLeftRight,ArrowUpDown,ImagePlus,SlidersHorizontal,Eye,EyeOff,ChevronDown,Plus,X} from 'lucide-react';
import {RibbonTextSizeIcon,RibbonCornerRadiusIcon} from './SmartRibbonIcons';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import type {BuilderRibbonProperty,BuilderTab,Design2Slot,Design2SlotRule} from './builderPropertyInventory';
import {HIDDEN_RIBBON_PROPERTY_KEYS,hasDesign2LayoutEquivalent} from './layoutRibbonVisibility';
import RibbonColorPalette from './RibbonColorPalette';
import {uploadTenantImageFile} from '../ComponentProperties/TenantMediaPicker';
import {scopedFieldRule,type ScopedFieldFilter} from '../../pages/PageRuntime/fieldScopedRecordFilters';
import RecordFilterEditor from '../../../component-libraries/shared/primitives/RecordFilterEditor/RecordFilterEditor';
import SmartFormulaField from './SmartFormulaField';
import {bindingDisplayLabel,readCanvasBinding,writeCanvasBinding,type CanvasBindingTarget} from './canvasDataBindingTargets';
import {validateRecordFilterFormula} from '../../pages/PageRuntime/recordFilterFormula';
import {sessionCollectionFields} from '../../pages/PageRuntime/pageCollectionListBinding';
import {pageStateChoices} from './pageStateChoices';
import {namedCollectionName,namedCollectionNames} from '../../pages/PageRuntime/pageCollectionSession';
import {formulaCollectionReferenceKey} from '../../../../../server/src/expression-engine/FormulaCollection.js';
import SmartIconDropdown from './SmartIconDropdown';
import Design2IconDropdown from './Design2IconDropdown';
import SmartMultiSelect from './SmartMultiSelect';
import SmartIconGallery from './SmartIconGallery';
import Design2CanvasActions from './Design2CanvasActions';
import BuilderNumberInput from './BuilderNumberInput';
import {smartTabsHaveDataSource} from './smartTabsCountSource';
import type {ArrangeRibbonProps} from './ArrangeRibbon';
import './SmartRibbon.css';
import './SmartRibbonApprovedThreeRow.css';
import './SmartRibbonDataFormula.css';
import './SmartRibbonDesign2.css';
type Position={x:number;y:number;width:number;height:number};
type Props={tab:BuilderTab;api:string;definitions:readonly BuilderRibbonProperty[];properties:Record<string,unknown>;
 onChange:(next:Record<string,unknown>,editedKeys?:readonly string[])=>void;objects:readonly ObjectMetadata[];pageObjectApiName?:string;
 position?:Position;onPositionChange?:(next:Position,editedFields?:readonly (keyof Position)[])=>void;layoutMode:string;
 /** For grouped/multiple components, expose only the intersection of SQL properties. */
 sharedPropertyIds?:readonly string[];mixedPropertyIds?:readonly string[];selectedApis?:readonly string[];
 pageComponents?:readonly {id:string;properties:Record<string,unknown>}[];componentId?:string;
 canvasBinding?:CanvasBindingTarget|null;
 design2Slots?:readonly Design2Slot[];design2SlotRules?:readonly Design2SlotRule[];componentVisible?:boolean;
 onVisibleChange?:(visible:boolean)=>void;
 design2Arrange?:ArrangeRibbonProps;
 inspectorSection?:string|null;
 onInspectorSectionChange?:(section:string|null)=>void;
 openDesignSection?:string|null;onToggleDesignSection?:(section:string)=>void;
 /** Data only: 'formulaBar' renders just the Formula Bar (topbar); 'source' just the
  * Source object selectors (end of Design). Both reuse this single Data engine. */
 part?:'formulaBar'|'source';};
const weekdays=[['sun','Sun'],['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat']] as const;
const fallback=(value:unknown)=>typeof value==='string'?value:'';
const cartSummaryLabels:Record<string,{key:string;slot:string}>={
 subtotalValue:{key:'subtotalLabel',slot:'Summary 1'},
 totalValue:{key:'totalLabel',slot:'Summary 2'},
 taxValue:{key:'taxLabel',slot:'Summary 3'},
 discountValue:{key:'discountLabel',slot:'Summary 4'}
};
// Left/right side of buttons inside a row; also set by dragging the button on the canvas.
const partSidePropertyIds=['cardButtonPlacement','customButton1Placement','customButton2Placement',
 'qtyIncreasePlacement','qtyDecreasePlacement'];
export default function SmartRibbon({tab,api,definitions,properties,onChange,objects,pageObjectApiName='',position,onPositionChange,layoutMode,sharedPropertyIds,mixedPropertyIds,selectedApis,pageComponents=[],componentId='',canvasBinding=null,design2Slots=[],design2SlotRules=[],componentVisible=true,onVisibleChange,design2Arrange,inspectorSection,onInspectorSectionChange,openDesignSection,onToggleDesignSection,part}:Props){
 const uploadInput=useRef<HTMLInputElement>(null);
 const [uploadBusy,setUploadBusy]=useState(false);
 const [uploadError,setUploadError]=useState('');
 const selectLocalImage=async(event:ChangeEvent<HTMLInputElement>)=>{
   const file=event.target.files?.[0];
   event.target.value='';
   if(!file)return;
   setUploadBusy(true);setUploadError('');
   try{
     const imageSource=await uploadTenantImageFile(file);
     onChange({...properties,imageSourceMode:'upload',imageSource},['imageSource']);
   }catch(reason){
     setUploadError(reason instanceof Error?reason.message:'Image upload failed');
   }finally{setUploadBusy(false);}
 };
 const stateOptions=pageStateChoices(pageComponents);
 const duplicateCollectionName=(()=>{
  const name=namedCollectionName(properties.collectionFormula);
  if(!name)return '';
  return pageComponents.some(item=>item.id!==componentId
   &&namedCollectionName(item.properties.collectionFormula)?.toLowerCase()===name.toLowerCase())
    ?'Duplicate collection name on this page: '+name:'';
 })();
 const validateCollection=(next:string):string|null=>{
  const names=namedCollectionNames(next);
  if(!names.length)return null;
  for(const name of names){
   const alias=formulaCollectionReferenceKey(name).toLowerCase();
   if(pageComponents.some(item=>item.id!==componentId&&Object.values(item.properties)
     .some(value=>namedCollectionNames(value).some(other=>
       formulaCollectionReferenceKey(other).toLowerCase()===alias))))
    return 'Duplicate Collection name: '+name;
  }
  if(/"(?:[^"]|"")*"\s*@([A-Za-z])/i.test(next))
   return 'Missing comma before the field reference';
  // Empty strings are valid explicit Field/Criteria placeholders.
  if(/,\s*(?:,|\))/.test(next))return 'Enter a value after the comma';
  return null;
 };

 const expandedInspector=inspectorSection===undefined?'Body':inspectorSection;
 const chooseInspectorSection=(section:string)=>onInspectorSectionChange?.(expandedInspector===section?null:section);
 // The Page Builder owns a single initially closed accordion. Canvas area
 // selection (inspectorSection) remains independent of this open-section state.
 const designSectionOpen=(section:string)=>openDesignSection===section;
 const toggleDesignSection=(section:string)=>onToggleDesignSection?.(section);
 const [countKey,setCountKey]=useState('cardsPerRow');
 const [filtersOpen,setFiltersOpen]=useState(false);
 const [filterTarget,setFilterTarget]=useState('Record');
 const [filterFieldId,setFilterFieldId]=useState<string|null>(null);
 const [selectedDataField,setSelectedDataField]=useState<string|null>('__record_filter__');
 const formulaInputHost=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(tab!=='Data'||canvasBinding?.componentId!==componentId||
    selectedDataField!==canvasBinding.propertyKey)return;
  formulaInputHost.current?.querySelector<HTMLInputElement>('.smart-formula input')?.focus();
 },[tab,componentId,selectedDataField,canvasBinding?.requestId]);
 const [daysOpen,setDaysOpen]=useState(false);
 const daysButton=useRef<HTMLButtonElement>(null);
 const daysMenu=useRef<HTMLDivElement>(null);
 const [daysPosition,setDaysPosition]=useState({top:0,left:0});
 useLayoutEffect(()=>{
  // Select the clicked Data binding before the Formula Bar paints or focuses.
  setDaysOpen(false);setFiltersOpen(false);
  setSelectedDataField(tab==='Data'&&canvasBinding?.componentId===componentId
   ?canvasBinding.propertyKey:'__record_filter__');
 },[tab,api,componentId,canvasBinding?.requestId]);
 useEffect(()=>{
   if(!filtersOpen)return;
   const close=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')setFiltersOpen(false);};
   document.addEventListener('keydown',close);
   return()=>document.removeEventListener('keydown',close);
 },[filtersOpen]);
 useLayoutEffect(()=>{
   if(!daysOpen)return;
   const position=()=>{
     const rect=daysButton.current?.getBoundingClientRect();
     if(!rect){setDaysOpen(false);return;}
     setDaysPosition({top:Math.max(6,Math.min(rect.bottom+3,window.innerHeight-242)),
       left:Math.max(6,Math.min(rect.left,window.innerWidth-180))});
   };
   const outside=(event:PointerEvent)=>{
     const target=event.target as Node;
     if(!daysButton.current?.contains(target)&&!daysMenu.current?.contains(target))setDaysOpen(false);
   };
   const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setDaysOpen(false);};
   position();
   window.addEventListener('resize',position);
   window.addEventListener('scroll',position,true);
   document.addEventListener('pointerdown',outside);
   document.addEventListener('keydown',escape);
   return()=>{
     window.removeEventListener('resize',position);
     window.removeEventListener('scroll',position,true);
     document.removeEventListener('pointerdown',outside);
     document.removeEventListener('keydown',escape);
   };
 },[daysOpen]);
 // Explicit selections only: the page object must not silently supply field suggestions.
 const sourceObjectKeys=Object.keys(properties).filter(key=>/^objectApiName(?:[2-9]|[1-9][0-9]+)?$/.test(key))
  .sort((a,b)=>(a==='objectApiName'?1:Number(a.slice(13)))-
    (b==='objectApiName'?1:Number(b.slice(13))));
 const sourceObjectNames=sourceObjectKeys
  .map(key=>fallback(properties[key])).filter((name,index,all)=>name&&all.indexOf(name)===index);
 const sourceCount=Math.min(100,Math.max(1,Number(properties.objectSourceCount)||1,
  ...sourceObjectKeys.filter(key=>fallback(properties[key])).map(key=>
    key==='objectApiName'?1:Number(key.slice(13)))));
 const sourceBaseProperty=definitions.find(item=>item.id==='objectApiName'&&item.tab==='Data');
 const additionalSourceProperty=definitions.find(item=>item.id==='objectApiName2'&&item.tab==='Data');
 const canAddSources=Boolean(additionalSourceProperty?.components.includes(api)&&
  (!sharedPropertyIds||sharedPropertyIds.includes('objectApiName2')));
 const sourceKey=(index:number)=>index===1?'objectApiName':'objectApiName'+index;
 const updateSourceCount=(next:number)=>onChange({...properties,objectSourceCount:next,
   [sourceKey(next)]:properties[sourceKey(next)]??''},['objectSourceCount',sourceKey(next)]);
 const removeSource=(index:number)=>{
  const next={...properties};
  const values=Array.from({length:sourceCount},(_,offset)=>fallback(properties[sourceKey(offset+1)]))
    .filter((_,offset)=>offset!==index-1);
  for(let n=1;n<=sourceCount;n++)delete next[sourceKey(n)];
  values.forEach((name,offset)=>{next[sourceKey(offset+1)]=name;});
  next.objectSourceCount=values.length;
  onChange(next,['objectSourceCount',...Array.from({length:sourceCount},(_,i)=>sourceKey(i+1))]);
 };
 const sourceObjects=objects.filter(item=>sourceObjectNames.includes(item.apiName))
  .sort((a,b)=>sourceObjectNames.indexOf(a.apiName)-sourceObjectNames.indexOf(b.apiName));
 const objectName=sourceObjectNames[0]??'';
 const object=objects.find(o=>o.apiName===objectName);
 const canFilterSessionCollection=pageComponents.some(item=>Object.values(item.properties)
  .some(value=>namedCollectionNames(value).length>0));
 const availableFilterFields=object?.fields??(canFilterSessionCollection?[...sessionCollectionFields]:[]);
 const update=(key:string,value:unknown)=>onChange({...properties,[key]:value},[key]);
 // Filter target comes from the originating button, not a second modal selector.
 const openFilters=(target:string,fieldId:string|null=null)=>{
  setFilterTarget(target);setFilterFieldId(fieldId);setFiltersOpen(true);
 };
 const storedFieldFilters=properties.dataFieldFilters;
 const fieldFilterRule=(id:string)=>scopedFieldRule(storedFieldFilters,id);
 const updateFieldFilter=(id:string,patch:Partial<ScopedFieldFilter>)=>{
   if(!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(id))return;
   const existing=storedFieldFilters&&typeof storedFieldFilters==='object'&&!Array.isArray(storedFieldFilters)
     ?storedFieldFilters as Record<string,unknown>:{};
   const previous=fieldFilterRule(id)??{filters:[],filterLogic:'AND',filterFormula:''};
   onChange({...properties,dataFieldFilters:{...existing,[id]:{...previous,...patch}}},['dataFieldFilters']);
 };
 const filterCount=Array.isArray(properties.filters)?properties.filters.length:0;
 // Keep the global property inventory visible for every selected component.
 // Unsupported controls are disabled by the per-property `supported` check below.
 const compactDesign=true;
 // These components declare exactly their editable areas through SQL mapping rows.
 const fixedAreaComponents=new Set(['smart_numpad','smart_keyboard','smart_dock']);
 // Independent SQL-planned view over shared controls and persisted property keys.
 // A null property key displays the fallback glyph, always disabled.
 // SQL supplies the shared area order. Retired aliases cannot return from
 // an older cached catalog during rolling deployment.
 const retiredDesign2Areas=new Set(['Tabs','Card Grid',
   'Custom Button 1','Custom Button 2','Calendar']);
 // Keep the shared slot inventory intact for existing components. The
 // Numpad declares exactly its seven editable areas through SQL mapping rows.
 const design2Areas=[...new Map(design2Slots
   .filter(slot=>!retiredDesign2Areas.has(slot.area))
   .map(slot=>[slot.area,slot.areaOrder] as const)).entries()]
   .sort((a,b)=>a[1]-b[1]).map(([area])=>area)
   .filter(area=>area==='Others'||!fixedAreaComponents.has(api)||design2SlotRules.some(rule=>
     rule.componentApi===api&&rule.area===area));
 // Focused/Others/Extras are not places on the canvas; they live in Others.
 const nonCanvasDesign2Areas=new Set(['Focused','Others','Extras']);
 const canvasDesign2Areas=design2Areas.filter(area=>!nonCanvasDesign2Areas.has(area));
 const activeDesign2Area=expandedInspector&&canvasDesign2Areas.includes(expandedInspector)?expandedInspector:'Body';
 const approvedMatrixAreas=new Set(design2SlotRules.map(rule=>rule.area));
 // A SINGLE, fixed Design scaffold for all sections and selected components.
 // Image placement and fill participate in the shared Position/Typography rows.
 // SQL still owns every semantic property binding and enabled/disabled rule.
 // Focused and Extras are canonical sections, not component-specific overlays.
 // Fixed VISUAL order, shared across all Design areas and components.
 // SQL continues to own bindings, persisted property keys and eligibility.
 // The Focused accordion already contains the focus editor; omit its duplicate icon.
 const design2DockColumns:Record<string,number>={
   '1:fill':1,'1:border':2,'1:shape':3,'1:shapeFill':4,'1:orientation':5,'1:radius':6,
   '2:height':1,'2:width':2,'2:shadow':3,'2:placement':4,
   '3:text':1,'3:alignment':2,'3:bold':3,'3:wrap':4,'3:imageFill':5,'3:size':6
 };
 const design2DockNumericSlots=new Set(['radius','height','width','size']);
 const design2TemplateSlots=[
   ...design2Slots.filter(slot=>slot.area==='Body'&&!slot.slotKey.startsWith('extra_')),
   ...design2Slots.filter(slot=>slot.area==='Image'&&
     (slot.slotKey==='placement'||slot.slotKey==='imageFill'))
 ].filter(slot=>slot.slotKey!=='focused')
   .map(slot=>({...slot,
     order:design2DockColumns[slot.row+':'+slot.slotKey]??slot.order,
     width:design2DockNumericSlots.has(slot.slotKey)?60:slot.width}))
   .sort((a,b)=>a.row-b.row||a.order-b.order);
 const design2RenderedSlots:Design2Slot[]=design2Areas.flatMap(area=>{
  const areaSlots=design2Slots.filter(slot=>slot.area===area);
  return design2TemplateSlots.map(template=>{
   const actual=areaSlots.find(slot=>slot.slotKey===template.slotKey);
   const bodyImagePlacement=area==='Body'&&template.slotKey==='placement'&&
    ['smart_card_grid','smart_image','smart_cart'].includes(api);
   return {...template,area,
    propertyKey:bodyImagePlacement?'imagePlacement':actual?.propertyKey??null,
    fallbackKey:actual?.fallbackKey??template.fallbackKey};
  });
 });
 const design2Properties=tab==='Design2'?design2RenderedSlots
   .map(slot=>{
     const approved=design2SlotRules.find(rule=>
       rule.componentApi===api&&rule.area===slot.area&&rule.slotKey===slot.slotKey);
     // In specified areas ONLY the explicit Yes cells may be enabled.
     // A missing Yes rule leaves an inert glyph occupying the SAME R/C position.
     const imageApi=['smart_card_grid','smart_image','smart_cart'].includes(api);
     const migratedBodyKey=slot.area==='Body'&&api==='smart_tabs'&&
       (slot.slotKey==='width'||slot.slotKey==='height')
         ?(slot.slotKey==='width'?'tabWidth':'tabHeight'):
       slot.area==='Body'&&slot.slotKey==='placement'&&imageApi?'imagePlacement':
       slot.area==='Image'&&imageApi&&slot.slotKey==='height'?'imageHeight':
       slot.area==='Image'&&imageApi&&slot.slotKey==='placement'?'imagePlacement':
       slot.area==='Image'&&['smart_card_grid','smart_image','smart_cart','smart_navigation'].includes(api)&&
         slot.slotKey==='imageFill'?'imageFill':
       slot.area==='Header'&&imageApi&&slot.slotKey==='height'?'headerBoxHeight':
       slot.area==='Header Supporting'&&api==='smart_cart'&&slot.slotKey==='height'?'supportingBoxHeight':null;
     const propertyKey=migratedBodyKey??(approvedMatrixAreas.has(slot.area)
       ?approved?.propertyKey:slot.propertyKey);
     const assigned=propertyKey?definitions.find(p=>p.id===propertyKey):undefined;
     const fallbackDefinition=definitions.find(p=>p.id===slot.fallbackKey);
     const fallbackKind:BuilderRibbonProperty['kind']=
       ['fill','border','focused','text','shapeFill','shape_fill'].includes(slot.slotKey)?'color':
       slot.slotKey==='alignment'?'align':
       slot.slotKey==='shadow'?'shadow':
       ['bold','wrap'].includes(slot.slotKey)?'boolean':
       ['selection','shape','textMode','orientation','placement','imageFill'].includes(slot.slotKey)?'choice':'number';
     const original:BuilderRibbonProperty=assigned??fallbackDefinition??{
       id:slot.fallbackKey,label:slot.slotKey,tab:'Design2',group:slot.area,
       kind:fallbackKind,components:[]
     };
     return {...original,label:slot.slotKey==='focused'?'Focused Color':original.label,
       tab:'Design2' as const,group:slot.area,
       components:assigned?assigned.components:[],
       designRow:slot.row,designOrder:slot.order,
       designWidth:slot.width,designHeight:slot.height,designCaptionWidth:0,
       designDisplay:original.kind==='align'||original.kind==='shadow'?'dropdown' as const:original.designDisplay};
   }):[];
 // Independent properties stay editable below the 16-icon shared matrix.
 // Count, Padding and supplemental Card Grid properties live in Extras at
 // fixed positions; all retain their original keys, types and eligibility.
 const design2SupplementalProperties:BuilderRibbonProperty[]=tab==='Design2'?design2Slots
   .filter(slot=>slot.area==='Extras'&&
     ['extra_cardGap','extra_selectionMode'].includes(slot.slotKey))
   .sort((a,b)=>a.order-b.order)
   .flatMap(slot=>{
     // Use this component's rule, else any component's rule for the same slot,
     // so the property is still listed (disabled) when this component lacks it.
     const rule=design2SlotRules.find(item=>item.componentApi===api&&
       item.area===slot.area&&item.slotKey===slot.slotKey)??
       design2SlotRules.find(item=>item.area===slot.area&&item.slotKey===slot.slotKey);
     const property=definitions.find(item=>item.id===rule?.propertyKey);
     // Always listed; controls() disables it when this component lacks it.
     return property?[{...property,
       tab:'Design2' as const,group:'Extras',designRow:slot.row,designOrder:slot.order,
       designWidth:slot.width,designHeight:slot.height,designCaptionWidth:0}]:[];
   }):[];
 // Generic SQL-defined controls belonging to a particular Design area.
 // Do not create component-specific editor widgets or a parallel settings tab.
 const design2AreaExtraProperties:BuilderRibbonProperty[]=tab==='Design2'?design2Slots
   .filter(slot=>slot.area!=='Extras'&&slot.slotKey.startsWith('extra_'))
   .sort((a,b)=>a.areaOrder-b.areaOrder||a.order-b.order)
   .flatMap(slot=>{
     const rule=design2SlotRules.find(item=>item.componentApi===api&&
       item.area===slot.area&&item.slotKey===slot.slotKey)??
       design2SlotRules.find(item=>item.area===slot.area&&item.slotKey===slot.slotKey);
     const fixed=slot.area==='Others'||slot.slotKey.startsWith('extra_calendar');
     const property=definitions.find(item=>item.id===(fixed?slot.propertyKey:rule?.propertyKey));
     // Fixed Body/Header/Focused/Others rows persist for every component selection.
     // SQL property rules decide the enabled/disabled state, never row visibility.
     // Always listed for every selection; controls() enables/disables it.
     return property?[{...property,
       tab:'Design2' as const,group:slot.area,
       designRow:slot.row,designOrder:slot.order,
       designWidth:slot.width,designHeight:slot.height,designCaptionWidth:0}]:[];
   }):[];
 // Physical dock placement only: fixed six/four/six columns use 60px
 // numeric editors and existing 40px icon editors. SQL property bindings,
 // values and enable/disable states do not depend on those dimensions.
 const design2GridColumns=(row:number)=>{
   const slots=design2TemplateSlots.filter(slot=>slot.row===row);
   return Array.from({length:row===2?4:6},(_,index)=>{
     const slot=slots.find(item=>item.order===index+1);
     // Fixed across every dropdown, including disabled/unsupported cells.
     // The Image Placement slot is 40px wide at R2C5, adjacent to Width.
     return (slot?.width??(index>=2&&index<=4?80:40))+'px';
   }).join(' ');
 };
 const visible=definitions.filter(p=>p.tab===tab);
 const contextualVisible=tab==='Design2'?design2Properties:visible;
 // Keep active-record scope metadata and persisted settings intact, but do not
 // surface its automatic binding switch in any visible ribbon section.
 // A formula-created Collection now owns every tab; retired synthetic
 // leading-tab controls must not appear even with an older metadata snapshot.
 const retiredTabs=new Set(['firstTabCustom','firstTabCaption','firstTabValue']);
 // Design 2 owns shared design/position properties. Remove Layout duplicates
 // only where every selected component has an enabled, reachable Design control.
 const selectedComponentApis=selectedApis?.length?selectedApis:[api];
 const displayProperties=contextualVisible.filter(p=>!retiredTabs.has(p.id)&&
   !HIDDEN_RIBBON_PROPERTY_KEYS.has(p.id)&&
   p.id!=='autoRecordScope'&&p.id!=='collectionFormula'&&
   !(tab==='Data'&&p.id==='contextApiName')&&
   !(tab==='Layout'&&hasDesign2LayoutEquivalent(
     p.id,selectedComponentApis,p.components,design2Slots,design2SlotRules)));
 const groups=[...new Set(displayProperties.map(p=>p.group))];
 const groupOrder=tab==='Design2'?design2Areas
  :tab==='Data'?['Source','Values','Cart','Cart columns','Cart totals','Card Grid']
  :tab==='Design'?['Body','Shape','Typography','Tabs','Header','Badge','Header Supporting','Button',
    'Table','Row','Summary','Summary 2','Card Grid']
  :tab==='Layout'?['Size & Position','Tabs','Cards','Navigation','Calendar','Image','Icon']
  :[];
 const sections=[...groupOrder.filter(group=>groups.includes(group)),
  ...groups.filter(group=>!groupOrder.includes(group))];
 const sectionRow=(group:string,row:number)=>displayProperties
   .filter(p=>p.group===group&&((p.designRow??2)>=1&&(p.designRow??2)<=3?p.designRow??2:2)===row)
   .sort((a,b)=>(a.designOrder??999)-(b.designOrder??999));
 // Keep the metadata Data rows intact; never merge row three into row two.
 const dataSectionRow=(group:string,row:number)=>tab==='Data'&&group!=='Source'&&row===2
   ?[...sectionRow(group,2),...sectionRow(group,3)]:sectionRow(group,row);
 const isDataFormula=(p:BuilderRibbonProperty)=>p.group!=='Source'&&
   (p.kindOverrides?.[api]??p.kind)==='expression';
 // The same visible ƒx editor can edit a display binding or the source filter.
 // The source filter is an explicit mode, never inferred from the caption text.
 const filterFormulaSelected=tab==='Data'&&selectedDataField==='__record_filter__';
 const hasItemsSource=definitions.some(p=>p.id==='collectionFormula'&&
  p.tab==='Data'&&p.components.includes(api)&&(p.kindOverrides?.[api]??p.kind)==='expression');
 const activeDataProperty=tab==='Data'
   ?definitions.find(p=>p.tab==='Data'&&p.id===selectedDataField&&
     p.components.includes(api)&&(p.kindOverrides?.[api]??p.kind)==='expression'):undefined;
 const activeDataKey=activeDataProperty?.valueKeys?.[api]??activeDataProperty?.id??'';
 const selectedFieldRule=activeDataProperty?fieldFilterRule(activeDataProperty.id):undefined;
 // Record filtering and output-only visibility are different operations.
 const scopedFilterId=filterFieldId&&activeDataProperty?.id===filterFieldId?filterFieldId:null;
 const modalFieldRule=scopedFilterId?fieldFilterRule(scopedFilterId):undefined;
 const selectedFieldFilterCount=selectedFieldRule?.filters.length??0;
 const activeDataEnabled=Boolean(activeDataProperty&&activeDataProperty.components.includes(api)&&
   (!sharedPropertyIds||sharedPropertyIds.includes(activeDataProperty.id)));
 const activeDataValue=activeDataProperty
   ?readCanvasBinding(properties,activeDataProperty.id==='tabCaptionFormula'&&
     canvasBinding?.componentId===componentId?canvasBinding:
     {propertyKey:activeDataProperty.id},activeDataKey)
     ||String(activeDataProperty.defaultsOverrides?.[api]??activeDataProperty.default??''):'';
 const changeRecordFilterFormula=(next:string)=>{
   if(!object)return;
   const formula=next.trimStart().startsWith('=')?next.trimStart().slice(1):next;
   // Keep ordinary saved data conditions active alongside the authored formula.
   onChange({...properties,filterFormula:formula,filterMode:undefined},['filterFormula','filterMode']);
 };
 const changeActiveDataFormula=(next:string)=>{
   if(!activeDataEnabled||!activeDataProperty)return;
   onChange(writeCanvasBinding(properties,activeDataProperty.id==='tabCaptionFormula'&&
     canvasBinding?.componentId===componentId?canvasBinding:
     {propertyKey:activeDataProperty.id},next,activeDataKey),[activeDataKey]);
 };
 // Geometry only. Keep every property, icon, dropdown and persisted value;
 // fit their existing three rows without reserving space for empty columns.
 const controlWidth=(p:BuilderRibbonProperty)=>{
   // Design 2 slot dimensions are exact SQL instructions, never normalized to 64px.
   if(tab==='Design2'&&p.designWidth!==undefined)return p.designWidth;
   // Reserve the exact SQL 30px input track; a separate 45px caption is added.
   if(p.id==='tabIndex')return p.designWidth??30;
   // Shape's 94px SQL width is exact, unlike other compact choice tracks.
   if(p.id==='shapeId')return p.designWidth??94;
   if(['cardButtonShape','customButton1Shape','customButton2Shape'].includes(p.id))return p.designWidth??94;
   // Shadow/Alignment icon dropdowns must remain at least 35px wide.
   if(p.designDisplay==='dropdown'&&(p.kind==='shadow'||p.kind==='align'))
     return Math.max(35,p.designWidth??0);
   const width=p.designWidth??(p.kind==='shadow'||p.kind==='align'?84:
     p.kind==='color'?40:p.kind==='number'||p.kind==='position'?64:
     p.kind==='boolean'?28:99);
   // Data retains its previous 64px numeric controls and full SQL formula widths.
   // Only the Design/Layout icon and spinner tracks get more compact.
   if(tab!=='Design'&&tab!=='Layout'&&p.designWidth&&
     (p.kind==='number'||p.kind==='position'))return 64;
   if(tab==='Design'||tab==='Layout'){
     if(p.kind==='number'||p.kind==='position')return Math.max(54,Math.min(width,58));
     if(p.kind==='choice'&&width>=80&&width<=110)return width-8;
   }
   return width;
 };
 // Match the actual Data chip spacing (2px), while preserving the 4px
 // spacing used by the other tabs and the three-row Source selectors.
 // SQL supplies each control width, including Column Visibility's native dropdown.
 const sectionWidth=(group:string)=>Math.ceil(Math.max(
   Math.max(0,...(tab==='Data'&&group!=='Source'?[1,2]:[1,2,3]).map(row=>{
     const properties=dataSectionRow(group,row);
     return properties.reduce((sum,p)=>sum+controlWidth(p)+
       (tab==='Data'&&isDataFormula(p)?0:(p.designCaptionWidth??0)),0)
       +Math.max(0,properties.length-1)*(tab==='Data'&&group!=='Source'?2:4);
   }))+15,
   group.length*5.5+16
 ));
 const controls=(property:BuilderRibbonProperty)=>{
   const slotPlacement=tab==='Design2'?design2RenderedSlots.find(slot=>
     slot.area===property.group&&slot.row===property.designRow&&slot.order===property.designOrder):undefined;
   const sharedKey=tab==='Data'&&/^objectApiName(?:[4-9]|[1-9][0-9]+)$/.test(property.id)
    ?'objectApiName2':property.id;
   const supported=property.components.includes(api)&&(!sharedPropertyIds||
     sharedPropertyIds.includes(property.id)||sharedPropertyIds.includes(sharedKey));
   const kind=api==='smart_calendar'&&property.id==='shadow'
     ? 'shadow' : property.kindOverrides?.[api]??property.kind;
   const key=api==='smart_calendar'&&property.id==='shadow'?'shadow':property.valueKeys?.[api]??property.id;
   const isSize=property.id==='width'||property.id==='height';
   const useCanvasPosition=layoutMode==='free-canvas'&&Boolean(position&&onPositionChange);
   const condition=property.enabledWhenOverrides?.[api]??property.enabledWhen;
   const conditionValue=condition?properties[condition.property]??(
     definitions.find(p=>p.id===condition.property)?.defaultsOverrides?.[api]??
     definitions.find(p=>p.id===condition.property)?.default
   ):undefined;
   const primaryOptions=property.choicesOverrides?.[api]??property.choices??[];
   const options=selectedApis&&selectedApis.length>1
     ?primaryOptions.filter(option=>selectedApis.every(member=>{
       const choices=property.choicesOverrides?.[member]??property.choices??[];
       return choices.length===0||choices.includes(option);
     })):primaryOptions;
   const enabled=supported&&(kind!=='position'||isSize||useCanvasPosition)&&
     (!condition||condition.in.includes(String(conditionValue??'')))&&
     (kind!=='choice'||!sharedPropertyIds||options.length>0);
   // Components saved before Style existed render Classic; show that, not the new-insert default.
   const value=mixedPropertyIds?.includes(property.id)?'':properties[key]??
    (property.id==='visualStyle'?'Classic':property.defaultsOverrides?.[api]??property.default??'');
   const write=(v:unknown)=>{
    if(!enabled)return;
    if(kind==='position'&&useCanvasPosition&&position&&onPositionChange&&typeof v==='number'){
     onPositionChange({...position,[property.id]:v},[property.id as keyof Position]);
    }else if(kind==='position'&&isSize&&typeof v==='number')update(key,v);
    else if(kind!=='position')update(key,v);
   };
   const title=property.label;
   const summaryLabel=api==='smart_cart'?cartSummaryLabels[property.id]:undefined;
   // Presentation-only shortening: metadata keys, persisted values and full
   // accessible names are retained. Unsupported properties stay disabled.
   const labelOverrides:Record<string,string>={
     badgeAlignment:'Position',imagePlacement:'Place',imageFill:'Fit',
     navigationDirection:'Direction',tabCount:'Tabs',firstDay:'First day'
   };
   const shortLabel=compactDesign?(property.designCaption??labelOverrides[property.id]??title):title;
   if(tab==='Data'&&isDataFormula(property)){
     const selected=selectedDataField===property.id;
     return <div key={property.id} data-property={property.id} data-kind={kind}
       data-supported={supported} className={'smart-property smart-data-field'+(!enabled?' disabled':'')}
       style={{'--smart-control-width':controlWidth(property)+'px',
         '--smart-caption-width':'0px','--smart-control-height':'26px'} as CSSProperties}>
       <span className="smart-data-field-pair">
         <button type="button" className="smart-data-field-name" disabled={!enabled}
           aria-label={'Select formula for '+title} onClick={()=>setSelectedDataField(property.id)}>{shortLabel}</button>
         <button type="button" disabled={!enabled} aria-pressed={selected}
           aria-label={'Formula for '+title} title={'Edit '+title+' formula'}
           className={'smart-data-field-fx'+(selected?' is-selected':'')}
           onClick={()=>setSelectedDataField(property.id)}>ƒx</button>
       </span>
     </div>;
   }
   const isTextSize=compactDesign&&/^(textSize|badgeTextSize|cardButtonTextSize|summary2?TextSize|rowSupportingTextSize|customButton[12]TextSize|placeholderSize|headerTextSize|supportingTextSize|rowTextSize|focusedTextSize)$/.test(property.id);
   const isCorner=compactDesign&&/radius/i.test(property.id);
   const isWidth=compactDesign&&/width/i.test(property.id);
   const isHeight=compactDesign&&/height/i.test(property.id);
   const isCanvasAxis=tab==='Design2'&&property.designRow===0&&
     (property.id==='x'||property.id==='y');
   const hasNumericIcon=(kind==='number'||kind==='position')&&
     (isTextSize||isCorner||isWidth||isHeight||isCanvasAxis);
   const isTabIndex=property.id==='tabIndex';
   let editor;
   if(/^dockItem[1-6]Icon$/.test(property.id))editor=<SmartIconGallery value={String(value||'house')}
     disabled={!enabled} allowIcons onChange={write}/>;
   else if(property.id==='shapeId'||property.id==='numpadKeyShape'||(tab==='Design2'&&property.id==='footerShape'))editor=<SmartIconGallery value={String(value||'shape:rectangle')}
     disabled={!enabled} allowIcons={property.id==='footerShape'?false:(selectedApis?.length?selectedApis:[api]).every(member=>
       (property.choicesOverrides?.[member]??property.choices??[]).includes('icons'))}
     onChange={write}/>;
   else if(['cardButtonShape','customButton1Shape','customButton2Shape','customButton3Shape'].includes(property.id))editor=<SmartIconGallery
     value={String(value||'shape:round-rectangle')} disabled={!enabled}
     allowIcons={false} onChange={write}/>;
   else if(property.id==='imageSource'&&supported){
     // The source is always editable: any direct or nested lookup reference
     // is resolved by the shared metadata engine, never by an image-name list.
     editor=<div className="smart-formula-filter smart-image-source-editor">
       <span className="smart-formula-prefix" title={title}>{shortLabel}</span>
       <SmartFormulaField value={String(value)} label={title} disabled={!enabled}
         fields={object?.fields??[]} objects={objects} rootObjectApiName={objectName}
         selectedSourceObjects={sourceObjects} mentionKind="image" stateOptions={stateOptions}
         onChange={source=>{if(enabled)onChange({...properties,imageSource:source,imageSourceMode:'field'},['imageSource']);}}/>
       {api==='smart_image'&&<button type="button" className="smart-filter-trigger"
         title="Upload image from this computer" aria-label="Upload image" disabled={uploadBusy||!enabled}
         onClick={()=>uploadInput.current?.click()}><ImagePlus size={16}/></button>}
     </div>;
   }else if(kind==='expression')editor=<div className="smart-formula-filter">
     {summaryLabel?<input type="text" className="smart-summary-label"
       aria-label={summaryLabel.slot+' cart label'} title={summaryLabel.slot+' displayed cart label'}
       placeholder={summaryLabel.slot} maxLength={64} spellCheck={false}
       disabled={!enabled} value={fallback(properties[summaryLabel.key])}
       onChange={event=>{if(enabled)update(summaryLabel.key,event.target.value);}}/>:
       <span className="smart-formula-prefix" title={title}>{shortLabel}</span>}
     <SmartFormulaField value={String(value)} onChange={write}
       validate={validateCollection} stateOptions={stateOptions}
       label={title} disabled={!enabled}
       singleFieldOnly={api==='smart_toggle'&&property.id==='textSource'}
       fields={api==='smart_toggle'&&property.id==='textSource'
         ?(object?.fields??[]).filter(field=>['Checkbox','Boolean'].includes(field.dataType))
         :object?.fields??[]}
       objects={objects} rootObjectApiName={objectName}
        selectedSourceObjects={sourceObjects} />
     {property.id==='collectionFormula'&&duplicateCollectionName&&
       <span role="alert" className="smart-collection-error">{duplicateCollectionName}</span>}
   </div>;
   else if(tab==='Design'&&property.id==='badgeAlignment')editor=
     <div className="smart-inline-caption-select">
       <span aria-hidden="true">Alignment</span>
       <select className="smart-select" aria-label={title} title={title}
         disabled={!enabled} value={String(value)}
         onChange={event=>write(event.target.value)}>
         <option value="">Select</option>
         {options.map(option=><option key={option} value={option}>
           {option.replaceAll('-',' ')}
         </option>)}
       </select>
     </div>;
   else if(kind==='object')editor=<select className="smart-select" aria-label={title} disabled={!enabled} value={String(value)}
     onChange={e=>write(e.target.value)}><option value="">Select Object</option>
     {objects.map(o=><option key={o.apiName} value={o.apiName}>{o.label}</option>)}</select>;
   else if(kind==='color')editor=<RibbonColorPalette variant="property"
     kind={/border/i.test(property.id)?'border':property.id==='iconFillColor'||/label|text|value/i.test(property.id)?'text':'fill'}
     iconVariant={tab==='Design2'&&(property.id==='shapeFill'||slotPlacement?.slotKey==='shape_fill')?'shape':
       tab==='Design2'&&(slotPlacement?.slotKey==='focused'||/^focus/i.test(property.id))?'focus':undefined}
     label={title} value={String(value)} disabled={!enabled} onChange={write}/>;
   else if(tab==='Layout'&&['cardsPerRow','cardsPerColumn'].includes(property.id))
     editor=<select className="smart-select" aria-label={title} disabled={!enabled}
       value={String(Number(value)||1)} onChange={event=>write(Number(event.target.value))}>
       {Array.from({length:6},(_,i)=>i+1).map(n=><option key={n} value={n}>
         {property.id==='cardsPerRow'?'Columns ':'Rows '}{n}
       </option>)}
     </select>;
   else if(kind==='number'||kind==='position')editor=<span className="smart-numeric">
     {isTextSize?<span className="smart-property-glyph" title={title}><RibbonTextSizeIcon/></span>:
      isCorner?<span className="smart-property-glyph" title={title}><RibbonCornerRadiusIcon/></span>:
      isWidth?<span className="smart-property-glyph" title={title}><ArrowLeftRight size={17} aria-hidden="true"/></span>:
      isHeight?<span className="smart-property-glyph" title={title}><ArrowUpDown size={17} aria-hidden="true"/></span>:
      isCanvasAxis?<span className="smart-property-glyph" title={title}>
        {property.id==='x'?<ArrowLeftRight size={17} aria-hidden="true"/>:
          <ArrowUpDown size={17} aria-hidden="true"/>}
      </span>:
      property.id==='width'?<ArrowLeftRight size={15}/>:property.id==='height'?<ArrowUpDown size={15}/>:null}
     <BuilderNumberInput key={componentId+':'+property.id}
       className="smart-office-number" aria-label={title} disabled={!enabled}
       min={property.min??0} max={property.max} step={isTabIndex?1:undefined}
       integer={isTabIndex}
       value={kind==='position'&&useCanvasPosition?position?.[property.id as keyof Position]??'':
        typeof value==='string'?(Number.isNaN(Number.parseFloat(value))?'':Number.parseFloat(value)):value as number}
       onValueChange={n=>write(isTabIndex?Math.max(0,Math.trunc(n)):n)}/>
   </span>;
   else if(kind==='shadow'&&compactDesign&&property.designDisplay==='dropdown')editor=<SmartIconDropdown kind="shadow" value={String(value)} label={title} disabled={!enabled} onChange={write}/>;
   else if(kind==='shadow')editor=<div className="smart-icons" role="group" aria-label={title}>
     {['none','medium','large'].map((opt,i)=><button key={opt} type="button" disabled={!enabled} title={opt}
       aria-label={title+' '+opt} aria-pressed={value===opt} onClick={()=>write(opt)}><span
         style={{boxShadow:i===0?'none':i===1?'1px 2px 3px #64748b':'2px 4px 8px #64748b'}}/></button>)}
   </div>;
   else if(kind==='align'&&compactDesign&&property.designDisplay==='dropdown')editor=<SmartIconDropdown kind="align" value={String(value)} label={title} disabled={!enabled} onChange={write}/>;
   else if(kind==='align')editor=<div className="smart-icons" role="group" aria-label={title}>
     {([['left',AlignLeft],['center',AlignCenter],['right',AlignRight]] as const).map(([opt,Icon])=>
       <button type="button" key={opt} disabled={!enabled} title={opt}
        aria-label={title+' '+opt} aria-pressed={value===opt} onClick={()=>write(opt)}><Icon size={15}/></button>)}
   </div>;
   else if(kind==='boolean'){
     if(compactDesign&&property.id==='badgeVisible'){
       const Icon=value===true?Eye:EyeOff;
       editor=<button type="button" className="smart-visible-toggle" disabled={!enabled}
         role="switch" aria-label={title} title={title} aria-checked={value===true}
         onClick={()=>write(value!==true)}><Icon size={16} aria-hidden="true"/></button>;
     }else if(['headerBold','badgeBold','supportingBold','rowBold','summaryTextWeight','summary2TextWeight',
       'focusedTextBold','rowSupportingBold','footerBold','cardButtonBold',
       'wrapText','rowWrapText','summaryWrapText','footerWrapText',
       'cardButtonWrapText','rowSupportingWrapText'].includes(property.id)){
       const Icon=property.id.toLowerCase().includes('wrap')?WrapText:Bold;
       editor=<button className="smart-icon-toggle" type="button" disabled={!enabled}
         aria-label={title} title={title} aria-pressed={value===true} onClick={()=>write(value!==true)}><Icon size={17}/></button>;
     }else editor=<input type="checkbox" aria-label={title} disabled={!enabled}
       checked={value===true} onChange={e=>write(e.target.checked)}/>;
   }else if(kind==='weekdays')editor=<div className="smart-weekdays">
     <button ref={daysButton} type="button" disabled={!enabled} onClick={()=>setDaysOpen(v=>!v)}
       aria-label={title} aria-expanded={daysOpen}>Days ▾</button>
     {daysOpen&&createPortal(<div ref={daysMenu} className="smart-weekday-popup" role="dialog"
       aria-label="Choose calendar days" style={{top:daysPosition.top,left:daysPosition.left}}>
       {weekdays.map(([day,label])=><label key={day}>
         <input type="checkbox" checked={Array.isArray(value)&&value.includes(day)}
           onChange={e=>write(e.target.checked?[...(Array.isArray(value)?value:[]),day]:
             (Array.isArray(value)?value:[]).filter(x=>x!==day))}/>{label}</label>)}
     </div>,document.body)}
   </div>;
   else if(property.id==='defaultCheck')editor=<button type="button" role="switch"
     className="smart-default-check-switch" aria-label={title}
     aria-checked={value===true||value==='true'} disabled={!enabled}
     onClick={()=>write(!(value===true||value==='true'))}>
     <span className="smart-default-check-thumb" aria-hidden="true"/>
   </button>;
   // The R3C2 alignment and R2C6/R3C6 image controls in the approved
   // Design 2 matrix are ICON dropdowns. Legacy Design remains unchanged.
   else if(tab==='Design2'&&kind==='choice'&&property.id==='badgeAlignment')
     editor=<SmartIconDropdown kind="badgeAlignment" value={String(value)} label={title} disabled={!enabled} onChange={write}/>;
   else if(tab==='Design2'&&kind==='choice'&&
     (['imageFill','imagePlacement','tabOrientation','navigationDirection'].includes(property.id)||
      partSidePropertyIds.includes(property.id)))
     editor=<Design2IconDropdown
       mode={property.id==='imagePlacement'||partSidePropertyIds.includes(property.id)?'placement':
         property.id==='imageFill'?'imageFill':'orientation'}
       value={String(value)} label={title} disabled={!enabled} allowed={options} onChange={write}/>;
   else if(kind==='choice'&&Array.isArray(value))editor=<SmartMultiSelect
      label={title} choices={options} value={value.filter((item):item is string=>typeof item==='string')}
      disabled={!enabled} onChange={write}/>;
    else if(kind==='choice')editor=<select className="smart-select" aria-label={title}
     title={value?title+': '+String(value):title} disabled={!enabled}
     value={String(value)} onChange={e=>write(e.target.value)}><option value="">Select</option>
     {options.map(s=><option value={s} key={s}>{s.replaceAll('-',' ')}</option>)}</select>;
   return <div key={slotPlacement?slotPlacement.area+':'+slotPlacement.slotKey:property.id}
       className={'smart-property'+(!enabled?' disabled':'')} data-property={property.id}
       data-design-slot={slotPlacement?.slotKey}
       data-design-column={tab==='Design2'&&property.designRow===0?property.designOrder:slotPlacement?.order}
       data-supported={supported} data-kind={kind} data-numeric-icon={hasNumericIcon?'true':'false'}
       data-design-caption={compactDesign&&Boolean(property.designCaptionWidth)?'true':'false'}
       style={compactDesign?{'--smart-control-width':controlWidth(property)+'px',
         '--smart-caption-width':(property.designCaptionWidth??0)+'px',
         '--smart-control-height':(property.designHeight??26)+'px',
         ...(slotPlacement?{'--smart-slot-column':slotPlacement.order}: {})} as CSSProperties:undefined}
       title={!enabled?'Applies to: '+property.components.map(api=>api.replace(/^smart_/,'' )).join(', '):title}>
       <span className="smart-label">{shortLabel}</span>{editor}</div>;
 };
 return <div className={'smart-ribbon'+(tab==='Design2'?' smart-design2-ribbon':'')+
   (part==='formulaBar'?' smart-topbar-formula':part==='source'?' smart-design-source':'')}
  data-smart-tab={tab} data-smart-api={api} data-smart-part={part}
  data-compact-design={compactDesign?'true':'false'}
  data-three-row={compactDesign?'true':'false'} aria-label="Smart shared property ribbon">
  <input ref={uploadInput} className="smart-hidden-upload" type="file"
    accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Select local image"
    onChange={event=>void selectLocalImage(event)} />
  {uploadError&&<div className="smart-upload-error" role="alert" title={uploadError}>{uploadError}</div>}
  {tab==='Design2'?<section className="smart-ribbon-group smart-design2-group"
      data-design-three-row="true" data-smart-tab="Design2" aria-label="Design 2 contextual properties">
    <div className="smart-design2-workbench">
      <section className="smart-inspector-section smart-design2-dimensions-section">
        <button type="button" className="smart-inspector-section-toggle"
          aria-expanded={designSectionOpen('Dimensions & Alignment')}
          onClick={()=>toggleDesignSection('Dimensions & Alignment')}>
          <ChevronDown size={15} aria-hidden="true"/>Dimensions & Alignment
        </button>
        {designSectionOpen('Dimensions & Alignment')&&<div className="smart-inspector-section-content">
      <div className="smart-design2-context" data-design-row={0}>
        <div className="smart-design2-dimensions" role="group" aria-label="Dimensions">
        {(()=>{
          const shown=componentVisible;
          const toggle=onVisibleChange?()=>onVisibleChange(!componentVisible):undefined;
          return <button type="button" className="smart-icon-toggle smart-design2-visibility"
            aria-label="Component visibility" title="Component visibility"
            aria-pressed={shown} disabled={!toggle} onClick={toggle}>
            {shown?<Eye size={17}/>:<EyeOff size={17}/>}
          </button>;
        })()}
        {(['x','y'] as const).map((id,index)=>{
          // Row 0 C3/C4 edits the SAME canvas position used by Layout.
          // No duplicate instance properties or separate position state.
          const property=definitions.find(entry=>entry.id===id);
          return property&&property.components.includes(api)
            ?controls({...property,tab:'Design2',group:'Position',
                designRow:0,designOrder:index+3,designWidth:80,designHeight:26,
                designCaptionWidth:0})
            :<span key={id} className="smart-design2-empty-position"
               data-design-row="0" data-design-column={index+3}
               aria-hidden="true"/>;
        })}
        <span className="smart-design2-r0-gap" data-design-column="5" aria-hidden="true"/>
        <span className="smart-design2-r0-gap" data-design-column="6" aria-hidden="true"/>
        </div>
        <Design2CanvasActions area={activeDesign2Area} arrange={design2Arrange} section="alignment"/>
        <Design2CanvasActions area={activeDesign2Area} arrange={design2Arrange} section="arrangement"/>
        <Design2CanvasActions area={activeDesign2Area} arrange={design2Arrange} section="dimensions"/>
      </div>
        </div>}
      </section>
      <div className="smart-design2-area-list">
      <section className="smart-inspector-section smart-design2-area-section smart-design2-properties-section" data-design-area={activeDesign2Area}>
        <button type="button" className="smart-inspector-section-toggle"
          aria-expanded={designSectionOpen('Properties')} onClick={()=>toggleDesignSection('Properties')}>
          <ChevronDown size={15} aria-hidden="true"/>Properties
          <span className="smart-design2-active-area" title="Click a part of the component on the canvas to edit it">{activeDesign2Area}</span>
        </button>
        {designSectionOpen('Properties')&&<div className="smart-inspector-section-content">
          <div className="smart-ribbon-items">
            {[1,2,3].map(row=><div key={row} className="smart-ribbon-row"
              data-design-row={row} style={{gridTemplateColumns:design2GridColumns(row)}}>
              {sectionRow(activeDesign2Area,row).map(controls)}
            </div>)}
          </div>
        </div>}
      </section>
      {design2Areas.includes('Focused')&&<section className="smart-inspector-section smart-design2-area-section smart-design2-focused-section" data-design-area="Focused">
        <button type="button" className="smart-inspector-section-toggle"
          aria-expanded={designSectionOpen('Focused')} onClick={()=>toggleDesignSection('Focused')}>
          <ChevronDown size={15} aria-hidden="true"/>Focused
        </button>
        {designSectionOpen('Focused')&&<div className="smart-inspector-section-content">
          <div className="smart-ribbon-items">
            {[1,2,3].map(row=><div key={row} className="smart-ribbon-row"
              data-design-row={row} style={{gridTemplateColumns:design2GridColumns(row)}}>
              {sectionRow('Focused',row).map(controls)}
            </div>)}
          </div>
          {design2AreaExtraProperties.some(property=>property.group==='Focused')&&
            <div className="smart-design2-supplemental" role="group" aria-label="Focused settings">
              {design2AreaExtraProperties.filter(property=>property.group==='Focused').map(property=>
                <div className="smart-design2-supplemental-setting" key={property.id}>
                  <span className="smart-design2-supplemental-label" title={property.label}>{property.label}</span>
                  {controls(property)}
                </div>)}
            </div>}
        </div>}
      </section>}
      <section className="smart-inspector-section smart-design2-area-section smart-design2-others-section" data-design-area="Others">
        <button type="button" className="smart-inspector-section-toggle"
          aria-expanded={designSectionOpen('Others')} onClick={()=>toggleDesignSection('Others')}>
          <ChevronDown size={15} aria-hidden="true"/>Others
        </button>
        {designSectionOpen('Others')&&<div className="smart-inspector-section-content">
          {(()=>{
            // One fixed list for every selection: same properties, same order.
            const seen=new Set<string>();
            const list=[...design2AreaExtraProperties,...design2SupplementalProperties]
              .filter(property=>property.group!=='Focused'&&!/^focused/i.test(property.id))
              .filter(property=>!seen.has(property.id)&&Boolean(seen.add(property.id)));
            // Every existing property stays within Others, grouped for readability.
            // Each retains its SQL binding and existing control/disabled behaviour.
            const category=(id:string)=>{
              if(['numpadPadding','numpadGap','gap'].includes(id))return 'Spacing';
              if(id.startsWith('calendar')||id==='showDays'||id==='firstDay')return 'Calendar';
              if(id==='inputRows')return 'Text';
              if(id==='selectionMode')return 'Selection';
              if(id.startsWith('numpad'))return 'Input Settings';
              return 'Additional';
            };
            return <div className="smart-others-groups">
              {['Spacing','Calendar','Input Settings','Text','Selection','Additional'].map(group=>{
                const members=list.filter(property=>category(property.id)===group);
                return members.length>0&&<div className="smart-others-property-group" key={group} role="group" aria-label={group}>
                  <div className="smart-others-property-heading">{group}</div>
                  <div className="smart-design2-supplemental">
                    {members.map(property=><div className="smart-design2-supplemental-setting" key={property.id}>
                      <span className="smart-design2-supplemental-label" title={property.label}>{property.label}</span>
                      {controls(property)}
                    </div>)}
                  </div>
                </div>;
              })}
            </div>;
          })()}
        <div className="smart-others-property-heading smart-others-extra-heading">Additional controls</div>
        <div className="smart-design2-extras-fixed" role="group" aria-label="Additional appearance and spacing controls">
          {/* Both editors occupy fixed positions, preserving component-aware availability. */}
          <div className="smart-design2-extras-cell">
            {(()=>{
            // Select existing persisted property keys; no duplicate count state.
            const options=api==='smart_card_grid'
            ?[{key:'cardsPerRow',label:'Columns'},{key:'cardsPerColumn',label:'Rows'}]:
            api==='smart_tabs'
            ?[{key:'tabCount',label:'No. of tabs'},{key:'tabIndex',label:'Default tab'}]:
            api==='smart_cart'?[{key:'cardsPerRow',label:'Count'}]:[];
            const key=options.some(option=>option.key===countKey)?countKey:(options[0]?.key??'');
            const property=definitions.find(p=>p.id===key);
            const supported=Boolean(property?.components.includes(api)&&
            (!sharedPropertyIds||sharedPropertyIds.includes(key)));
            const sourceBound=api==='smart_tabs'&&key==='tabCount'&&smartTabsHaveDataSource(properties);
            const enabled=supported&&!sourceBound;
            const raw=properties[property?.valueKeys?.[api]??key]??
            property?.defaultsOverrides?.[api]??property?.default;
            const numeric=Number(raw);
            const value=Number.isFinite(numeric)?Math.trunc(numeric):key==='tabIndex'?0:1;
            const title=sourceBound?'Number of tabs is determined by its data source':
            property?.label??'Count';
            const minimum=property?.min??(key==='tabIndex'?0:1);
            const maximum=property?.max??(key==='tabIndex'?99:api==='smart_tabs'?20:99);
            const selectedDays=Array.isArray(raw)?raw.filter((day):day is string=>typeof day==='string'):[];
            return <div className="smart-design2-count" role="group"
            aria-label="Appearance value controls" data-supported={enabled?'true':'false'}
            data-source-bound={sourceBound?'true':'false'}>
            <span className="smart-design2-count-field" title={title}>
            <select className="smart-design2-count-choice" aria-label="Appearance property"
            title="Choose appearance property" disabled={options.length<2}
            value={key} onChange={event=>{setCountKey(event.target.value);setDaysOpen(false);}}>
            {options.length?options.map(option=>
            <option key={option.key} value={option.key}>{option.label}</option>):
            <option value="">Count</option>}
            </select>
            {key==='showDays'?<>
            <button ref={daysButton} type="button" className="smart-design2-days-trigger"
            aria-label="Show Days" aria-expanded={daysOpen} disabled={!enabled}
            onClick={()=>setDaysOpen(open=>!open)}>{selectedDays.length}/7</button>
            {daysOpen&&createPortal(<div ref={daysMenu} className="smart-weekday-popup"
            role="dialog" aria-label="Choose calendar days"
            style={{top:daysPosition.top,left:daysPosition.left}}>
            {weekdays.map(([day,label])=><label key={day}>
            <input type="checkbox" checked={selectedDays.includes(day)}
            onChange={event=>{if(!enabled)return;
            onChange({...properties,showDays:event.target.checked
            ?[...selectedDays,day]:selectedDays.filter(item=>item!==day)},['showDays']);
            }}/>{label}</label>)}
            </div>,document.body)}
            </>:
            key==='firstDay'?<select className="smart-design2-day-choice"
            aria-label="First Day" title="First Day" disabled={!enabled}
            value={String(raw??'mon')} onChange={event=>{
            if(enabled)onChange({...properties,[property!.valueKeys?.[api]??key]:event.target.value},[property!.valueKeys?.[api]??key]);
            }}>{(property?.choices??['sun','mon','tue','wed','thu','fri','sat']).map(day=>
            <option key={day} value={day}>{day.slice(0,3)}</option>)}</select>:
            <BuilderNumberInput key={componentId+':'+key}
            className="smart-office-number" step={1} integer
            aria-label={api==='smart_tabs'&&key==='tabCount'?'Number of tabs':title}
            title={title} min={minimum} max={maximum}
            disabled={!enabled} value={supported?value:''}
            onValueChange={next=>{
            if(enabled)onChange({...properties,[property!.valueKeys?.[api]??key]:next},[property!.valueKeys?.[api]??key]);
            }}/>}
            </span>
            </div>;
            })()}
          </div>
          <div className="smart-design2-extras-cell">
            {(()=>{
            // Position retains the existing Card Grid padding key, not a new focused override.
            const property=definitions.find(p=>p.id==='cardPadding');
            const enabled=api==='smart_card_grid'&&
            Boolean(property?.components.includes(api))&&
            (!sharedPropertyIds||sharedPropertyIds.includes('cardPadding'));
            const raw=properties.cardPadding??property?.defaultsOverrides?.[api]??property?.default;
            const value=raw===undefined||raw===null||raw===''?'':Number(raw);
            return <div className="smart-design2-padding" role="group"
            aria-label="Padding controls" data-supported={enabled?'true':'false'}>
            <select aria-label="Position spacing property" title="Padding"
            disabled={!enabled} value="cardPadding" onChange={()=>{}}>
            <option value="cardPadding">Padding</option>
            </select>
            <BuilderNumberInput key={componentId+':cardPadding'}
            className="smart-office-number" aria-label="Card Padding"
            title="Card Padding" min={property?.min??0} max={property?.max??160}
            disabled={!enabled} value={enabled?value:''}
            onValueChange={next=>{
            if(enabled)onChange({...properties,cardPadding:next},['cardPadding']);
            }}/>
            </div>;
            })()}
          </div>
        </div>
        </div>}
      </section>
      </div>
    </div>
  </section>:tab==='Data'?<>
    {part!=='formulaBar'&&sections.filter(group=>group==='Source').map(section=>
      <section className="smart-inspector-section smart-source-section" key={section} aria-label="Object Source">
        <div className="smart-source-heading">
          <button type="button" className="smart-inspector-section-toggle"
            aria-expanded={designSectionOpen('Object Source')} onClick={()=>toggleDesignSection('Object Source')}>
            <ChevronDown size={15} aria-hidden="true"/>Object Source ({sourceObjectNames.length})
          </button>
        </div>
        {designSectionOpen('Object Source')&&<div className="smart-inspector-section-content">
          <div className="smart-source-entries">
            {sourceBaseProperty&&Array.from({length:sourceCount},(_,i)=>{
              const index=i+1;
              const declared=definitions.find(item=>item.id===sourceKey(index)&&item.tab==='Data');
              const objectProperty:BuilderRibbonProperty={...(declared??sourceBaseProperty),id:sourceKey(index),
                components:declared?.components??(index>3&&canAddSources?sourceBaseProperty.components:[]),
                label:'Object '+index,designCaption:'Object '+index,
                designWidth:150,designCaptionWidth:52,default:'',
                valueKeys:undefined,defaultsOverrides:undefined};
              return <div className="smart-source-entry" key={index}>
                {controls(objectProperty)}
                {index>1&&<button type="button" className="smart-source-remove"
                  title={'Remove Object '+index} aria-label={'Remove Object '+index}
                  onClick={()=>removeSource(index)}><X size={14} aria-hidden="true"/></button>}
              </div>;
            })}
          </div>
          <button type="button" className="smart-source-add-label"
            disabled={!canAddSources||sourceCount>=100}
            onClick={()=>updateSourceCount(sourceCount+1)}><Plus size={14} aria-hidden="true"/> Add Object</button>
        </div>}
      </section>)}
    {part!=='source'&&<div className="smart-data-workspace">
      <div className="smart-data-formula-bar" aria-label="Data expression or record filter formula">
        {/* An optional collection is a SOURCE of records, edited in this same bar. */}
        {hasItemsSource&&<button type="button" className="smart-data-items-source"
          aria-label="Select items source formula"
          title="Items source: optional formula supplying the component's records"
          aria-pressed={selectedDataField==='collectionFormula'}
          onClick={()=>{setSelectedDataField('collectionFormula');
            requestAnimationFrame(()=>formulaInputHost.current?.querySelector('input')?.focus());}}>
          Items
        </button>}
        <span className="smart-data-fx-prefix" aria-hidden="true">ƒx</span>
        <button type="button" className="smart-data-filter-button"
          aria-label="Configure record filters"
          title="Configure filters visually (same record filtering engine as the Formula Bar)"
          disabled={!object&&!canFilterSessionCollection}
          onClick={()=>{setSelectedDataField('__record_filter__');openFilters('Record');}}
          aria-haspopup="dialog">
          <SlidersHorizontal size={16}/>{filterCount>0&&
            <span className="smart-filter-count">{filterCount}</span>}
        </button>
        <button type="button" className="smart-data-image-upload"
          disabled={uploadBusy||!activeDataEnabled||activeDataProperty?.id!=='imageSource'||api!=='smart_image'}
          title={activeDataProperty?.id==='imageSource'&&api==='smart_image'?'Upload image':'Select an image field to enable upload'}
          aria-label="Upload image"
          onClick={()=>uploadInput.current?.click()}><ImagePlus size={17}/></button>
        <span className="smart-data-active-binding" aria-live="polite">
          {activeDataProperty?.id==='collectionFormula'?'Items source':activeDataProperty?canvasBinding?.componentId===componentId&&canvasBinding.propertyKey===activeDataProperty.id&&canvasBinding.displayLabel?canvasBinding.displayLabel:bindingDisplayLabel(api,activeDataProperty.id,activeDataProperty.label):'Record filter'}
        </span>
        <div ref={formulaInputHost} className="smart-data-formula-input">
          {filterFormulaSelected?<SmartFormulaField key="__record_filter__"
            label="Record filter formula" value={typeof properties.filterFormula==='string'?properties.filterFormula:''}
            disabled={!object&&!canFilterSessionCollection} onChange={changeRecordFilterFormula}
            validate={value=>validateRecordFilterFormula(value.trimStart().replace(/^=\s*/,''),availableFilterFields)}
            stateOptions={stateOptions}
            fields={availableFilterFields} objects={objects} rootObjectApiName={objectName}
            selectedSourceObjects={sourceObjects}/>:
          activeDataProperty?<SmartFormulaField key={activeDataProperty.id+':'+(canvasBinding?.itemId??canvasBinding?.itemIndex??'')}
            label={activeDataProperty.id==='collectionFormula'?'Items source':canvasBinding?.componentId===componentId&&canvasBinding.propertyKey===activeDataProperty.id&&canvasBinding.displayLabel?canvasBinding.displayLabel:bindingDisplayLabel(api,activeDataProperty.id,activeDataProperty.label)} value={activeDataValue}
            disabled={!activeDataEnabled} onChange={changeActiveDataFormula}
            validate={validateCollection} stateOptions={stateOptions}
            singleFieldOnly={api==='smart_toggle'&&activeDataProperty.id==='textSource'}
            fields={api==='smart_toggle'&&activeDataProperty.id==='textSource'
              ?(object?.fields??[]).filter(field=>['Checkbox','Boolean'].includes(field.dataType))
              :object?.fields??[]}
            objects={objects} rootObjectApiName={objectName} selectedSourceObjects={sourceObjects}
            mentionKind={activeDataProperty.id==='imageSource'?'image':'text'}/>:
            <input type="text" disabled aria-label="Formula (select a field first)"
              placeholder="Select a field's Fx button to edit its formula"/>}
        </div>

      </div>

    </div>}
  </>:sections.map(section=><section className="smart-ribbon-group" key={section}
     data-design-three-row={compactDesign?'true':undefined} data-smart-tab={tab} aria-label={section}
     style={compactDesign?{'--smart-section-width':sectionWidth(section)+'px'} as CSSProperties:undefined}>
   <div className="smart-ribbon-items">
     {compactDesign?<>{[1,2,3].map(row=><div className="smart-ribbon-row" key={row}
       data-design-row={row}>{sectionRow(section,row).map(controls)}</div>)}</>:
       visible.filter(p=>p.group===section).map(controls)}
   </div>
   <span className="smart-ribbon-caption">{section}</span>
  </section>)}
  {filtersOpen&&createPortal(<div className="smart-dialog-backdrop smart-filter-backdrop"
       role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setFiltersOpen(false);}}>
    <section className="smart-dialog smart-filter-dialog smart-record-filter-dialog" role="dialog" aria-modal="true"
      aria-label="Record filters" onKeyDown={e=>{if(e.key==='Escape')setFiltersOpen(false);}}>
     <header><div><strong>Filter Records</strong>
       <span>{object?.label??'Session Collection'} · {scopedFilterId?filterTarget+' only':'All records'}</span></div>
       <button type="button" autoFocus onClick={()=>setFiltersOpen(false)}>Done</button></header>
     <div className="smart-filter-dialog-body">
       {(object||canFilterSessionCollection)?<RecordFilterEditor compact title={scopedFilterId?filterTarget+' value':(object?.label??'Session Collection')+' records'} fields={availableFilterFields} objects={objects} rootObjectApiName={objectName}
         stateOptions={stateOptions}
         filters={scopedFilterId?(modalFieldRule?.filters??[]):Array.isArray(properties.filters)?properties.filters:[]}
         formula={scopedFilterId?(modalFieldRule?.filterFormula??''):typeof properties.filterFormula==='string'?properties.filterFormula:''}
         mode={scopedFilterId
           ?(modalFieldRule?.filterMode??((modalFieldRule?.filterFormula??'').trim()?'Formula':'Field'))
           :(properties.filterMode==='Field'||properties.filterMode==='Formula'?properties.filterMode
             :typeof properties.filterFormula==='string'&&properties.filterFormula.trim()?'Formula':'Field')}
         onModeChange={filterMode=>scopedFilterId
           ?updateFieldFilter(scopedFilterId,{filterMode})
           :onChange({...properties,filterMode},['filterMode'])}
         onFormulaChange={filterFormula=>scopedFilterId?updateFieldFilter(scopedFilterId,{filterFormula}):onChange({...properties,filterFormula},['filterFormula'])}
         logic={scopedFilterId?(modalFieldRule?.filterLogic??'AND'):properties.filterLogic==='OR'?'OR':'AND'}
         onLogicChange={filterLogic=>scopedFilterId?updateFieldFilter(scopedFilterId,{filterLogic}):onChange({...properties,filterLogic},['filterLogic'])}
         onChange={filters=>scopedFilterId?updateFieldFilter(scopedFilterId,{filters}):onChange({...properties,filters},['filters'])}/>:
         <p>Choose an Object or bind a named Collection to configure filters.</p>}
     </div>
    </section></div>,document.body)}
 </div>;
}
