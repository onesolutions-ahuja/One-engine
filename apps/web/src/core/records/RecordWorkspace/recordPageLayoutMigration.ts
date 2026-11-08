import type {LightningPageMetadata,PageComponentMetadata,PageLayoutMetadata,PageLayoutCustomLinkMetadata,RelatedListSettingsMetadata} from '../../metadata/Definitions/metadata';

/** Only the published Record Page controls the presentation. Legacy SQL layouts
 * remain a safe fallback until a tenant explicitly publishes its replacements.
 * Record/Field permissions are enforced separately by OneEngine and CRUD.
 */
export function recordPagePresentationLayout(
  page:LightningPageMetadata|null|undefined,fallback:PageLayoutMetadata|undefined
):PageLayoutMetadata|undefined {
  if(!page||page.pageType!=='Record Page'||page.status!=='Active')return fallback;
  const controls=page.components.find(c=>c.type==='Record Actions'&&c.visible!==false);
  if(!controls)return fallback;
  const actions=Array.isArray(controls.properties.actions)
    ?controls.properties.actions.filter((x):x is string=>typeof x==='string'):fallback?.actions??[];
  const rawOverrides=controls.properties.actionOverrides;
  const actionOverrides:Partial<Record<'Edit'|'Clone'|'Delete',string>>={};
  if(rawOverrides&&typeof rawOverrides==='object'&&!Array.isArray(rawOverrides)){
    for(const standard of ['Edit','Clone','Delete'] as const){
      const id=(rawOverrides as Record<string,unknown>)[standard];
      if(actions.includes(standard)&&typeof id==='string'
        &&/^[A-Za-z][A-Za-z0-9_]*$/.test(id) &&id!==standard)
        actionOverrides[standard]=id;
    }
  }
  const rawLinks=controls.properties.customLinks;
  const customLinks=Array.isArray(rawLinks)
    ?rawLinks.filter((x):x is PageLayoutCustomLinkMetadata=>Boolean(x&&typeof x==='object'
      &&typeof x.id==='string'&&typeof x.label==='string'&&typeof x.url==='string'
      &&typeof x.openInNewWindow==='boolean'))
    :fallback?.customLinks??[];
  const rawSettings=controls.properties.relatedListSettings;
  const relatedListSettings=rawSettings&&typeof rawSettings==='object'&&!Array.isArray(rawSettings)
    ?rawSettings as Record<string,RelatedListSettingsMetadata>:fallback?.relatedListSettings;
  const rawVisibility=controls.properties.actionVisibility;
  const actionVisibility:NonNullable<PageLayoutMetadata['actionVisibility']>={};
  if(rawVisibility&&typeof rawVisibility==='object'&&!Array.isArray(rawVisibility)){
   for(const [actionId,condition] of Object.entries(rawVisibility)){
    if(!actions.includes(actionId))continue;
    // A malformed condition must remain explicitly hidden, not silently
    // become unconditional when the published metadata is reloaded.
    if(!condition||typeof condition!=='object'||Array.isArray(condition)){
      actionVisibility[actionId]={fieldApiName:'__invalid__',equalsValue:'',operator:'Never'};
      continue;
    }
    const entry=condition as Record<string,unknown>;
    const validField=typeof entry.fieldApiName==='string'
      &&/^[A-Za-z][A-Za-z0-9_]*$/.test(entry.fieldApiName);
    const validValue=typeof entry.equalsValue==='string'&&entry.equalsValue.length<=256;
    const operator=entry.operator??'Equals';
    if(!validField||!validValue
      ||!['Equals','NotEquals','Contains','IsBlank','IsNotBlank'].includes(String(operator))){
      actionVisibility[actionId]={fieldApiName:'__invalid__',equalsValue:'',operator:'Never'};
      continue;
    }
    actionVisibility[actionId]={fieldApiName:entry.fieldApiName as string,equalsValue:entry.equalsValue as string,
      ...(entry.operator!==undefined?{operator:operator as 'Equals'|'NotEquals'|'Contains'|'IsBlank'|'IsNotBlank'}:{})};
   }
  }
  return {
    ...(fallback??{id:'record-page',label:page.label,sections:[],relatedLists:[]}),
    actions,actionVisibility,actionOverrides,customLinks,relatedListSettings
  };
}

/** Explicit draft-only conversion from a legacy layout. Stable Object metadata
 * stays untouched; each device gets its own independent component instances.
 */
export function legacyLayoutToRecordComponents(
  layout:PageLayoutMetadata,existing:PageComponentMetadata[],device:string
):PageComponentMetadata[] {
  const owned=(id:string)=>id.startsWith('migrated-section-'+device+'-')
    ||id==='migrated-related-'+device||id==='record-actions-'+device;
  // Never delete hand-authored standard components or another device's
  // components. Repeated import preserves edits to converter-owned instances.
  const retained=existing.filter(component=>!owned(component.id)&&
    // The original unconfigured starter is a converter placeholder, not an
    // authored layout. Preserve every other standard/UNE component.
    !(component.id==='starter'&&component.type==='Record Detail'&&
      Object.keys(component.properties??{}).length===0));
  const previous=new Map(existing.filter(component=>owned(component.id))
    .map(component=>[component.id,component]));
  const sections=layout.sections.map((section,index):PageComponentMetadata=>({
    id:'migrated-section-'+device+'-'+index+'-'+section.id.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,48),
    type:'Field Section',label:section.label,region:'main',visible:true,
    properties:{columns:section.columns,fieldApiNames:[...section.fieldApiNames],
      ...(section.requiredFieldApiNames?.length?{requiredFieldApiNames:[...section.requiredFieldApiNames]}:{}),
      ...(section.readOnlyFieldApiNames?.length?{readOnlyFieldApiNames:[...section.readOnlyFieldApiNames]}:{})}
  }));
  const related:PageComponentMetadata[]=layout.relatedLists.length?[{
    id:'migrated-related-'+device,type:'Related List',label:'Related Lists',region:'main',visible:true,
    properties:{relatedLists:[...layout.relatedLists]}
  }]:[];
  const controls:PageComponentMetadata={
    id:'record-actions-'+device,type:'Record Actions',label:'Record Actions',region:'header',visible:true,
    properties:{actions:[...layout.actions],customLinks:(layout.customLinks??[]).map(link=>({...link})),
      relatedListSettings:{...(layout.relatedListSettings??{})}}
  };
  const generated=[...sections,...related,controls];
  return [...retained,...generated.map(component=>previous.get(component.id)??component)];
}
