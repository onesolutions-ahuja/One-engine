import type {LightningPageMetadata,PageLayoutMetadata,PageLayoutSectionMetadata} from '../../metadata/Definitions/metadata';
import {recordPagePresentationLayout} from './recordPageLayoutMigration';
import {behaviorField} from '../../pages/PageRuntime/pageBehaviorRuntime';
import {isComponentVisible} from '../../components/Properties/componentVisibility';
import type {ComponentVisibilityContext} from '../../components/Properties/componentVisibility';

/** Resolve published Record Edit Field Sections into the existing generic CRUD form.
 * Record Detail retains its legacy Object Page Layout field configuration.
 * Object/Field/Record grants remain enforced by RecordFormDialog and the API.
 */
export function recordEditPageLayout(
  page: LightningPageMetadata | null | undefined,
  fallback: PageLayoutMetadata | undefined,
  context:ComponentVisibilityContext={formFactor:'Desktop'}
): PageLayoutMetadata | undefined {
  if (!page || page.pageType !== 'Record Page' || page.recordMode !== 'Edit'
    || page.status !== 'Active') return fallback;
  const presentation=recordPagePresentationLayout(page,fallback);
  const sections: PageLayoutSectionMetadata[] = [];
  const used = new Set<string>();
  let standalone: string[] = [];
  let standaloneRequired:string[] = [],standaloneReadOnly:string[] = [];
  const flush = () => {
    if (!standalone.length) return;
    sections.push({id:'record-fields-'+sections.length,label:'Record Information',
      columns:2,fieldApiNames:standalone,
      ...(standaloneRequired.length?{requiredFieldApiNames:standaloneRequired}:{}),
      ...(standaloneReadOnly.length?{readOnlyFieldApiNames:standaloneReadOnly}:{})});
    standalone = [];standaloneRequired=[];standaloneReadOnly=[];
  };
  const selectedFields=(source:unknown,available:readonly string[])=>{
    const values=Array.isArray(source)?source:[];
    return [...new Set(values.filter((value):value is string=>
      typeof value==='string'&&available.includes(value)))];
  };
  for (const component of page.components) {
    // Apply the same component-level visibility contract as the record renderer.
    // A page-level field/section condition must not be ignored by the edit form.
    if (!isComponentVisible(component,context,
      Boolean(context.fields||context.record||context.recordPermissions||context.profileId))) continue;
    if (component.type === 'Record Detail') {
      // Keep the standard Object Page Layout as fallback, but never let a
      // starter Record Detail block override subsequently authored dynamic fields.
      continue;
    }
    if (component.type === 'Record Field') {
      const name=component.properties?.fieldApiName;
      if (typeof name === 'string' && !used.has(name)) {
        const rule=behaviorField(component.properties,name,context);
        if(rule?.visible===false)continue;
        used.add(name);standalone.push(name);
        // Read-only wins over a conflicting layout-required declaration.
        if(component.properties.readOnlyOnLayout===true||rule?.readOnly)standaloneReadOnly.push(name);
        else if(component.properties.requiredOnLayout===true||rule?.required)standaloneRequired.push(name);
      }
    }
    if (component.type === 'Field Section') {
      flush();
      const raw=component.properties?.fieldApiNames;
      const names=Array.isArray(raw)?raw.filter((value):value is string=>typeof value==='string'):[];
      const unique=names.filter(name=>{
        if(used.has(name)||behaviorField(component.properties,name,context)?.visible===false)return false;
        used.add(name);return true;
      });
      if (unique.length){
        const readOnly=[...new Set([...selectedFields(component.properties?.readOnlyFieldApiNames,unique),
          ...unique.filter(name=>behaviorField(component.properties,name,context)?.readOnly)])];
        const required=[...new Set([...selectedFields(component.properties?.requiredFieldApiNames,unique),
          ...unique.filter(name=>behaviorField(component.properties,name,context)?.required)])]
          .filter(name=>!readOnly.includes(name));
        sections.push({id:component.id,label:component.label,
          columns:component.properties?.columns===1?1:2,fieldApiNames:unique,
          ...(required.length?{requiredFieldApiNames:required}:{}),
          ...(readOnly.length?{readOnlyFieldApiNames:readOnly}:{})});
      }
    }
  }
  flush();
  // An authored Dynamic Forms page with all conditional sections hidden must not
  // silently restore the legacy fields (and reveal fields the rule hid).
  if (!sections.length && !page.components.some(component=>
    component.type==='Record Field'||component.type==='Field Section')) return presentation;
  return {...(presentation ?? {id:'record-edit',label:page.label,relatedLists:[],actions:['New','Edit','Delete']}),
    label:page.label,sections};
}
