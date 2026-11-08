import { availableComponentSettings } from '../../../../components/Properties/componentSettingDefinitions';
import { componentNamePattern, canonicalComponentName, componentInstanceNames } from '../../../../../../../server/src/system-support/page-component-names';
import { useEffect, useState, type ReactNode } from 'react';
import {
CalendarDays, Grid2X2, Type, Square, Image as ImageIcon, MousePointer2, BarChart3, FormInput, List,
Star, PanelLeft, AlignHorizontalJustifyStart
} from 'lucide-react';
import type { ComponentVisibilityRule } from '../../../../components/Properties/componentVisibility';
import { supportsSmartActionEvent } from '../../SmartEventActionsRibbon';
import { isBuilderApi } from '../../builderPropertyInventory';
import { updateLayoutSettings, type LayoutSettingKey } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { isCanvasLocked } from '../../canvasInteractions';
import { canvasGroupKey, canvasGroupMembers, canvasGroupBounds } from '../../canvasLayerGroups';
import { isSharedCanvasProperty, mixedCanvasPropertyIds } from '../../canvasSharedRibbonProperties';
import { rawLayoutParentId } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { standardPageComponents } from '../../../../components/Catalog/index';
import { findRegisteredComponent } from '../../../../components/Registry/componentRegistryLookup';
import { type PageComponentMetadata } from '../../../../metadata/Definitions/metadata';

import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageEditorState } from '../usePageEditorState';

export function usePageComponentProperties(
  props: PageBuilderProps,
  editorState: ReturnType<typeof usePageEditorState>,
) {
  const { page, libraryComponents } = props;
  const {
    selected, groupEditId, selectionIds, canvasBinding, ribbonCatalog, ribbonTab, selectedId,
    updateComponent, setRibbonTab, setRibbonFilterDraft, inlineActionEvent, applyPage,
    pageLayouts, targetObject, migrationLayoutId,
  } = editorState;

  // One user-facing identity for navigator, ribbon, and CSV upserts.
  const validateInstanceName=(id:string,value:string):string|null=>{
    const name=value.trim();
    if(!componentNamePattern.test(name))
      return 'Start with a letter; use letters, numbers, spaces, hyphens or underscores (max 80 characters).';
    const names=componentInstanceNames(page.components);
    return [...names].some(([otherId,otherName])=>otherId!==id&&
      canonicalComponentName(otherName)===canonicalComponentName(name))
      ?'Component Name already exists on this page layout.':null;
  };
  const selectedGroupMembers = selected && page.layoutMode === 'free-canvas'
    ? groupEditId===selected.id ? [selected]
      : selectionIds.length>1
        ? page.components.filter(item=>selectionIds.includes(item.id)
          && item.position && !rawLayoutParentId(item) && !isCanvasLocked(item)
          && rawLayoutParentId(item)===rawLayoutParentId(selected))
        : canvasGroupMembers(page.components,selected)
    : [];
  const selectedGroupBounds = canvasGroupBounds(selectedGroupMembers);
  // Shift selection and persisted canvas groups use one shared-property context.
  const ribbonSelectedMembers = selected
    ? page.components.filter(item=>(selectionIds.length>1
      ? selectionIds.includes(item.id)
      : selectedGroupMembers.length>1
        ? selectedGroupMembers.some(member=>member.id===item.id)
        : item.id===selected.id))
    : [];
  // Formula Bar: a canvas field icon edits just its component, even inside a group.
  const dataSelectedMembers = selected&&canvasBinding?.componentId===selected.id
    ? [selected] : ribbonSelectedMembers;
  // Virtual copies serve multi-selection only; shared Design definitions stay intact.
  // Design 2 renders contextual slot rules as well as the global slot list.
  // Both sources must participate in multi-selection; otherwise a control may
  // appear enabled but edits to Header, Body or other contextual areas are lost.
  const design2FixedAndMigratedKeys=new Set([
    // Fixed Extras controls and the contextual aliases rendered by SmartRibbon.
    'cardsPerRow','cardsPerColumn','tabCount','tabIndex','showDays','firstDay',
    'cardPadding','tabWidth','tabHeight','imagePlacement','imageHeight','imageFill',
    'headerBoxHeight','supportingBoxHeight','shapeId','shapeFill'
  ]);
  const design2SharedDefinitions=ribbonCatalog?.properties.filter(property=>
    design2FixedAndMigratedKeys.has(property.id)||
    ribbonCatalog.design2Slots?.some(slot=>slot.propertyKey===property.id)||
    ribbonCatalog.design2SlotRules?.some(rule=>rule.propertyKey===property.id))
    .map(property=>({...property,tab:'Design2' as const}))??[];
  const sharedRibbonDefinitions=ribbonCatalog
    ?[...ribbonCatalog.properties,...design2SharedDefinitions]:[];
  const ribbonSharedPropertyIds = ribbonSelectedMembers.length>1&&ribbonCatalog
    ? ribbonCatalog.properties.filter(property=>isSharedCanvasProperty(property,ribbonSelectedMembers,ribbonCatalog.properties))
      .map(property=>property.id)
    : undefined;
  const ribbonMixedPropertyIds = ribbonSelectedMembers.length>1&&ribbonCatalog
    ? mixedCanvasPropertyIds(sharedRibbonDefinitions,
      ribbonTab==='Component Layout'?'Layout':
      ribbonTab==='Component Design 2'?'Design2':'Design',
      ribbonSelectedMembers)
    : undefined;
  const dataSharedPropertyIds = dataSelectedMembers.length>1&&ribbonCatalog
    ? ribbonCatalog.properties.filter(property=>isSharedCanvasProperty(property,dataSelectedMembers,ribbonCatalog.properties))
      .map(property=>property.id)
    : undefined;
  const dataMixedPropertyIds = dataSelectedMembers.length>1&&ribbonCatalog
    ? mixedCanvasPropertyIds(sharedRibbonDefinitions,'Data',dataSelectedMembers)
    : undefined;
  const groupCandidates=page.components.filter(item=>selectionIds.includes(item.id));
  const canGroupSelected=groupCandidates.length>1&&groupCandidates.every(item=>
    !!item.position&&!isCanvasLocked(item)&&!canvasGroupKey(item)&&
    rawLayoutParentId(item)===rawLayoutParentId(groupCandidates[0]));
  const [visibilityEditorOpen,setVisibilityEditorOpen]=useState(false);
  const [visibilityDraft,setVisibilityDraft]=useState<ComponentVisibilityRule|undefined>();
  useEffect(()=>{
    setVisibilityEditorOpen(false);
    setVisibilityDraft(selected?.properties.visibilityRules as ComponentVisibilityRule|undefined);
  },[selectedId]);
  const openVisibilityEditor=()=>{
    const raw=selected?.properties.visibilityRules;
    setVisibilityDraft(raw&&typeof raw==='object'&&!Array.isArray(raw)
      ?structuredClone(raw as ComponentVisibilityRule):undefined);
    setVisibilityEditorOpen(true);
  };
  const applyVisibilityEditor=()=>{
    if(!selected)return;
    const properties={...selected.properties};
    if(visibilityDraft)properties.visibilityRules=visibilityDraft;
    else delete properties.visibilityRules;
    updateComponent(selected.id,{properties});
    setVisibilityEditorOpen(false);
  };
  const textStyle = selected?.properties.layoutStyle && typeof selected.properties.layoutStyle==='object'
    ? selected.properties.layoutStyle as Record<string,unknown> : {};
  const currentRibbonDevice = page.layoutVariant==='Mobile'?'Phone':page.layoutVariant==='Custom'?'Base':page.layoutVariant??'Desktop';
  const updateTextStyle = (key:LayoutSettingKey,value:string|number|null) => {
    if (!selected)return;
    updateComponent(selected.id,{properties:updateLayoutSettings(selected.properties,currentRibbonDevice,key,value)});
  };
  const writeRibbonVisual = (key:string,value:unknown) => {
    if(!selected)return;
    const visual=selected.properties.visualStyle && typeof selected.properties.visualStyle==='object'
      ? selected.properties.visualStyle as Record<string,unknown>:{};
    updateComponent(selected.id,{properties:{...selected.properties,visualStyle:{...visual,[key]:value}}});
  };
  const writeRibbonColour = (key:'color'|'backgroundColor'|'borderColor'|'accentColor',value:string) => {
    if (!selected)return;
    const metadataKey=key==='color'?'textColor':key;
    const declared=selectedCustomDefinition?.propertyDefinitions?.some(item=>item.propertyKey===metadataKey);
    if(declared)updateComponent(selected.id,{properties:{...selected.properties,[metadataKey]:value}});
    else if(key!=='accentColor'&&key!=='color'&&currentRibbonDevice!=='Desktop'&&currentRibbonDevice!=='Base')updateTextStyle(key,value);
    else if(key!=='accentColor')writeRibbonVisual(key,value);
  };
  useEffect(() => {
    if (!selected && ((ribbonTab.startsWith('Component ')&&ribbonTab!=='Component Layout')||['Filters','Source'].includes(ribbonTab))) setRibbonTab('Add Block');
  }, [selectedId, page.components, ribbonTab]);
  // Keep the builder unselected on entry; the persistent topbar shows Welcome.
  // Canvas clicks establish the component selection explicitly.
  const openExpandedEditor = (kind:'source'|'filters') => {
    if(!selected)return;
    if(kind==='filters'){setRibbonFilterDraft({...selected.properties});setRibbonTab('Filters');return;}

    if(kind==='source'){setRibbonTab('Source');return;}
  };
  const selectedCustomDefinition = selected?.type.startsWith('Custom:')
    ? findRegisteredComponent(libraryComponents, selected.type.slice('Custom:'.length), 'page')
    : undefined;
  const selectedBuilderComponent=Boolean(selected?.type.startsWith('Custom:')&&isBuilderApi(selected.type.slice(7),ribbonCatalog?.components??[]));
  const rawSelectedActions=selected?.properties.actionFlows;
  const selectedActions=rawSelectedActions&&typeof rawSelectedActions==='object'&&!Array.isArray(rawSelectedActions)
    ?rawSelectedActions as Record<string,unknown>:{};
  const activeActionEvent=Object.prototype.hasOwnProperty.call(selectedActions,inlineActionEvent)
    ?inlineActionEvent:Object.keys(selectedActions)[0]??'';
  // Metadata declares the events. Smart controls additionally support the shared
  // page-session start event; only events common to the selection are editable.
  const actionMembers=ribbonSelectedMembers.length?ribbonSelectedMembers:selected?[selected]:[];
  const memberActionOptions=(item:PageComponentMetadata):Array<{apiName:string;label:string}>=>{
    const api=item.type.startsWith('Custom:')?item.type.slice(7):'';
    const definition=item.id===selected?.id?selectedCustomDefinition:
      api?findRegisteredComponent(libraryComponents,api,'page'):undefined;
    const declared=(definition?.eventDefinitions??[]).filter(event=>
      !api.startsWith('smart_')||supportsSmartActionEvent(api,event.apiName));
    const options=api.startsWith('smart_')?[...declared,
      {apiName:'start',label:'On Session Start'}]:declared;
    return options;
  };
  const actionOptions=actionMembers.length
    ?memberActionOptions(actionMembers[0]).filter(option=>
      actionMembers.every(member=>memberActionOptions(member).some(other=>other.apiName===option.apiName)))
    :[];
  if(selected)for(const event of Object.keys(selectedActions)){
    if(!actionOptions.some(option=>option.apiName===event) &&
      actionMembers.every(member=>member.id===selected.id||
        memberActionOptions(member).some(option=>option.apiName===event))){
      actionOptions.push({apiName:event,label:event});
    }
  }
  const actionSelectionDisabled=actionMembers.some(isCanvasLocked)
    || (actionMembers.length>1&&actionOptions.length===0);
  const mixedActionEventIds=actionMembers.length<2?[]:actionOptions
    .filter(option=>actionMembers.some(member=>{
      const bindings=member.properties.actionFlows;
      const events=bindings&&typeof bindings==='object'&&!Array.isArray(bindings)
        ?bindings as Record<string,unknown>:{};
      return JSON.stringify(events[option.apiName])!==JSON.stringify(selectedActions[option.apiName]);
    })).map(option=>option.apiName);
  const applyActionFlows=(actionFlows:Record<string,unknown>,editedEvents:readonly string[]=[])=>{
    if(!selected||actionSelectionDisabled)return;
    if(actionMembers.length>1){
      const explicitlyEdited=new Set(editedEvents);
      const sharedEvents=new Set(actionOptions.map(option=>option.apiName));
      const changed=[...new Set([...Object.keys(selectedActions),...Object.keys(actionFlows),...editedEvents])]
        .filter(key=>sharedEvents.has(key)&&(explicitlyEdited.has(key)||
          JSON.stringify(selectedActions[key])!==JSON.stringify(actionFlows[key])));
      const ids=new Set(actionMembers.map(item=>item.id));
      applyPage({...page,components:page.components.map(item=>{
        if(!ids.has(item.id))return item;
        const stored=item.properties.actionFlows&&typeof item.properties.actionFlows==='object'
          &&!Array.isArray(item.properties.actionFlows)
          ?item.properties.actionFlows as Record<string,unknown>:{};
        const next={...stored};
        for(const key of changed){
          if(key in actionFlows)next[key]=actionFlows[key];
          else delete next[key];
        }
        return {...item,properties:{...item.properties,actionFlows:next}};
      })});
    }else updateComponent(selected.id,{properties:{...selected.properties,actionFlows}});
  };
  // Shared Action-button visibility is component metadata, independent of the
  // configured Flow or formula. No app-specific action implementation is needed.
  const mixedActionButtonVisibilityKeys=actionMembers.length<2?[]:
    (['qtyIncrease','qtyDecrease','customButton1','customButton2','customButton3'] as const)
      .filter(key=>actionMembers.some(item=>
        (item.properties[key+'Visible']!==false)!==
        (actionMembers[0].properties[key+'Visible']!==false)));
  const applyCartButtonVisibility=(key:'qtyIncrease'|'qtyDecrease'|'customButton1'|'customButton2'|'customButton3',visible:boolean)=>{
    if(!selected||actionSelectionDisabled||!actionMembers.length||
      actionMembers.some(member=>!supportsSmartActionEvent(
        member.type.startsWith('Custom:')?member.type.slice(7):member.type,key)))return;
    const property=key+'Visible';
    if(actionMembers.length>1){
      const ids=new Set(actionMembers.map(item=>item.id));
      applyPage({...page,components:page.components.map(item=>ids.has(item.id)
        ?{...item,properties:{...item.properties,[property]:visible}}:item)});
    }else updateComponent(selected.id,{properties:{...selected.properties,[property]:visible}});
  };

  // Group positions stay fixed for every canvas selection. Metadata controls
  // availability; keys listed here are existing renderer-supported properties.
  // Disabled ribbon controls remain discoverable as icons, never blank panels.
  const ribbonPartIcons:Record<string,ReactNode>={
    Card:<Grid2X2 size={15}/>,Heading:<Type size={15}/>,
    'Supporting text':<AlignHorizontalJustifyStart size={15}/>,Badge:<Star size={15}/>,
    Image:<ImageIcon size={15}/>,Gallery:<Grid2X2 size={15}/>,
    Text:<Type size={15}/>,Button:<MousePointer2 size={15}/>,
    Table:<List size={15}/>,Calendar:<CalendarDays size={15}/>,Chart:<BarChart3 size={15}/>,
    Input:<FormInput size={15}/>,Navigation:<PanelLeft size={15}/>,Container:<Square size={15}/>
  };
  // Visible slots follow the selected component, as in the accepted blueprint.
  // Within each slot, the registry determines which commands are actually enabled.
  const designRibbonGroups:readonly string[] = selectedCustomDefinition?.apiName==='ui_item_grid'
    ? ['Surface','Card','Heading','Supporting text','Badge','Image']
    : selectedCustomDefinition?.apiName==='ui_calendar'
    ? ['Surface','Card','Heading','Event','Calendar']
    : ['Surface',...([
['ui_button','Button'],['ui_image','Image'],['ui_chart','Chart'],
      ['ui_table','Table'],['ui_navigation','Navigation'],['ui_search','Input'],
      ['ui_input','Input'],['ui_container','Container'],['ui_grid','Container'],
      ['ui_stack','Container'],['ui_split_pane','Container']
    ] as const).filter(([api])=>api===selectedCustomDefinition?.apiName).map(([,group])=>group)];
  const layoutRibbonGroups:readonly string[] = selected?.position ? ['Spacing','Component'] : ['Size','Position','Spacing','Component'];
  const appearanceDefinitions = availableComponentSettings(selectedCustomDefinition?.propertyDefinitions??[],page.layoutVariant??'Desktop',selectedCustomDefinition?.version);
  // Registry metadata remains authoritative. Legacy property declarations which omit
  // a presentation group are assigned only where the component already declares the key.
  const implicitParts:Record<string,Record<string,{group:string;section:'Design'|'Layout'}>> = {

    ui_button:{variant:{group:'Button',section:'Design'}},
    ui_item_grid:{cardDensity:{group:'Card',section:'Design'},cardHover:{group:'Card',section:'Design'},featuredColumnSpan:{group:'Component',section:'Layout'},featuredRowSpan:{group:'Component',section:'Layout'}},
    ui_calendar:{view:{group:'Calendar',section:'Design'},firstDayOfWeek:{group:'Calendar',section:'Design'},showWeekends:{group:'Calendar',section:'Design'}},
    ui_chart:{chartType:{group:'Chart',section:'Design'}},
    ui_image:{imageFit:{group:'Image',section:'Design'},imageHeight:{group:'Image',section:'Layout'}},
    ui_grid:{desktopColumns:{group:'Container',section:'Layout'},tabletColumns:{group:'Container',section:'Layout'},mobileColumns:{group:'Container',section:'Layout'}},
    ui_container:{direction:{group:'Container',section:'Layout'}},
    ui_stack:{direction:{group:'Container',section:'Layout'},wrap:{group:'Container',section:'Layout'}},
    ui_split_pane:{splitRatio:{group:'Container',section:'Layout'}},
    ui_navigation:{direction:{group:'Navigation',section:'Design'}},
    ui_table:{phoneLayout:{group:'Table',section:'Layout'}},
    ui_input:{inputType:{group:'Input',section:'Design'},multiline:{group:'Input',section:'Layout'},rows:{group:'Input',section:'Layout'}}
  };
  const inferredAppearanceGroup=(key:string)=>implicitParts[selectedCustomDefinition?.apiName??'']?.[key];
  const baseSurfaceKeys=new Set(['theme','surface','tone','accentColor','backgroundColor',
    'textColor','borderColor','density','radius','shadow','glassBlur','opacity']);
  const inferredRibbonGroup=(key:string,section:'Design'|'Layout')=>{
    if(section==='Design'&&baseSurfaceKeys.has(key))return 'Surface';
    if(section==='Layout'){
      if(/(?:min|max)?(?:Width|Height)$|^width$|^height$|^imageAspectRatio$/i.test(key))return 'Size';
      if(/(?:^|[A-Z])(padding|margin|gap)|^padding$|^margin$|^gap$/i.test(key))return 'Spacing';
      if(/position|offset|anchor/i.test(key))return 'Position';
      if(/columns|rows|span|fit|align|wrap|direction/i.test(key))return 'Component';
    }
    return undefined;
  };
  const definitionsForPart=(group:string,section:'Design'|'Layout')=>appearanceDefinitions.filter(definition=>{
    const mapped=inferredAppearanceGroup(definition.propertyKey);
    const part=section==='Layout'
      ? (mapped?.section==='Layout'?mapped.group:inferredRibbonGroup(definition.propertyKey,section))
      : ((definition as {group?:string}).group??mapped?.group??inferredRibbonGroup(definition.propertyKey,section));
    const mirroredImageDesign=section==='Design'&&selectedCustomDefinition?.apiName==='ui_item_grid'
      &&group==='Image'&&['imageAspectRatio','imagePosition'].includes(definition.propertyKey);
    const isDuplicateImageLayout=section==='Layout'&&selectedCustomDefinition?.apiName==='ui_item_grid'
      &&['imageAspectRatio','imagePosition'].includes(definition.propertyKey);
    const isInactiveFeaturedLayout=section==='Layout'&&selectedCustomDefinition?.apiName==='ui_item_grid'
      &&['featuredColumnSpan','featuredRowSpan'].includes(definition.propertyKey)
      &&!selected?.properties.featuredFieldApiName;
    return part===group&&!/(?:FieldApiName|ObjectApiName)$/.test(definition.propertyKey)
      &&!isDuplicateImageLayout&&!isInactiveFeaturedLayout
      && (mirroredImageDesign||(section==='Layout'
        ? ((definition as {section?:string}).section!=='Design')
          &&Boolean(inferredRibbonGroup(definition.propertyKey,section))
        : ((definition as {section?:string}).section??mapped?.section??'Design')===section));
  });
  const inferredGroupKeys=appearanceDefinitions.filter(d=>inferredAppearanceGroup(d.propertyKey)&&!(d as {group?:string}).group).map(d=>d.propertyKey);
  const selectedComponentDescription = selectedCustomDefinition?.description
    ?? standardPageComponents.find((component) => component.apiName === selected?.type)?.description
    ?? (selected?.type === 'Field Section' ? 'Group record fields into a configurable section.' : '');
  const assignedMigrationLayout = pageLayouts.find((layout) =>
    layout.id === targetObject?.pageLayoutAssignments?.[0]?.pageLayoutId) ?? pageLayouts[0];
  const selectedMigrationLayout = pageLayouts.find((layout) => layout.id === migrationLayoutId) ?? assignedMigrationLayout;
  const dynamicFormsEnabled = page.components.some((component) => component.type === 'Field Section' || component.type === 'Record Field');

  return {
    validateInstanceName, selectedGroupMembers, selectedGroupBounds, ribbonSelectedMembers,
    dataSelectedMembers, sharedRibbonDefinitions, ribbonSharedPropertyIds, ribbonMixedPropertyIds,
    dataSharedPropertyIds, dataMixedPropertyIds, canGroupSelected, visibilityEditorOpen,
    setVisibilityEditorOpen, visibilityDraft, setVisibilityDraft, openVisibilityEditor,
    applyVisibilityEditor, selectedCustomDefinition, selectedBuilderComponent, selectedActions, activeActionEvent,
    actionMembers, actionOptions, actionSelectionDisabled, mixedActionEventIds,
    mixedActionButtonVisibilityKeys, applyActionFlows, applyCartButtonVisibility,
    selectedComponentDescription, assignedMigrationLayout, selectedMigrationLayout, dynamicFormsEnabled,
  };
}
