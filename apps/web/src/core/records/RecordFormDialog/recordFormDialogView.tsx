import { useRuntimeFormFactor } from '../../workspace/Responsive/useFormFactor';
import { createPageBuilder } from '../../builders/PageBuilder/pageBuilderView';
import { ReportBuilder } from '../../builders/ReportBuilder/reportBuilderView';
import { createPermissions } from '../../security/Permissions/permissionsView';
import { createObjectManager } from '../../builders/ObjectManager/objectManagerView';
import { createSetupHome } from '../../settings/SetupHome/setupHomeView';
import { createSettingsViews } from '../../settings/SettingsWorkspace/settingsWorkspaceViews';
import { compactLayoutForRecord, matchesLookupFilterGroup, type RecordData } from '../RecordWorkspace/recordMetadataUtils';
import { formatRecordValue } from '../RecordWorkspace/recordCsvUtils';
import { initialScreenValues, screenFieldIsVisible } from '../../automation/FlowScreen/flowScreenRuntimeUtils';
import { objectSettings, parseAppRoute, appRoutePath, type AppRoute } from '../../workspace/Navigation/appRouting';
import { NavigationLoadTime, resolveCurrentAppNavigation } from '../../workspace/Navigation/appNavigationView';
import { isStandalonePagePresentation, pageCanvasPresentationStyle } from '../../pages/PageRuntime/pageRuntimePresentation';
import { insertFlowElementAtPath } from '../../builders/FlowBuilder/flowInsertElement.mjs';
import AdvancedSharingSettings from '../../security/Permissions/AdvancedSharingSettings';
import {resolveSetupNavigation} from '../../platform/Workspace/platformSetupNavigation';
import {readVerifiedMetadata,saveVerifiedMetadata,type MetadataPublicationResponse} from '../../metadata/Cache/verifiedMetadataCache';
import { queueOfflineRecord, listOfflineRecords, markOfflineRecord, removeOfflineRecord,
  synchronizeOfflineRecords, type OfflineQueueOwner, type OfflineRecordItem, type OfflineRecordWrite } from '../../metadata/Cache/offlineRecordQueue';
import SchemaBuilder from '../../builders/SchemaBuilder/SchemaBuilder';
import * as React from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import TenantMediaPicker from '../../builders/ComponentProperties/TenantMediaPicker';
import {acceptsTenantImageAsset} from './tenantImageTextField';
import TenantFilePicker from '../../builders/ComponentProperties/TenantFilePicker';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import FlowBuilderWorkspace from '../../builders/FlowBuilder/FlowBuilder';
import FlowScreenContent from '../../automation/FlowScreen/FlowScreenContent';
import FlowLogs from '../../automation/FlowLogs/FlowLogs';
import FlowInterviews from '../../automation/FlowInterviews/FlowInterviews';
import ScheduledFlows from '../../automation/ScheduledFlows/ScheduledFlows';
import DashboardBuilder from '../../builders/DashboardBuilder/DashboardBuilder';
import ComponentLibrary from '../../components/ComponentLibrary/ComponentLibrary';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import CustomComponentPropertyEditor from '../../builders/ComponentProperties/CustomComponentPropertyEditor';
import FlowInputBindingEditor from '../../builders/FlowInputBindingEditor/FlowInputBindingEditor';
import RecordFilterEditor from '../../../component-libraries/shared/primitives/RecordFilterEditor/RecordFilterEditor';
import ComponentVisibilityEditor from '../../builders/ComponentProperties/ComponentVisibilityEditor';
import PageRouteDirectory from '../../pages/PageRouteDirectory/PageRouteDirectory';
import { isComponentVisible } from '../../components/Properties/componentVisibility';
import PageComponentVisualEditor from '../../builders/ComponentStyleEditor/PageComponentVisualEditor';
import { canNestComponent, componentVisualStyle, directChildren, isLayoutType, isDescendantOf, layoutTypes } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import PageComponentStyleEditor from '../../builders/ComponentStyleEditor/PageComponentStyleEditor';
import { isCanvasLocked, wrapCanvasComponent, ungroupCanvasComponent } from '../../builders/PageBuilder/canvasInteractions';
import { filterPageComponentRecords, needsMetadataComponentRuntime } from '../../pages/PageRuntime/pageComponentBindings';
import { childrenOf, canNest, componentLayoutProps, hasPageComponentAppearance, isLayoutContainer, rawLayoutParentId, reparentComponent, resolvePageComponentStyle, type LayoutDevice } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import AppExchange from '../../applications/AppExchange/AppExchange';
import AppManager from '../../applications/AppManager/AppManager';
import PlatformWorkspaceSurface from '../../platform/Workspace/PlatformWorkspaceSurface';
import {GlobalRecordSearch} from '../../../component-libraries/shared/primitives/GlobalRecordSearch/GlobalRecordSearch';
import {RecordObjectPicker} from '../../../component-libraries/shared/primitives/RecordObjectPicker/RecordObjectPicker';
import {useDismissOnOutside} from '../../accessibility/Dismiss/useDismissOnOutside';
import { pageIsAvailableInApp, resolvePageActionRoute } from '../../pages/PageRuntime/pageActionRouting';
import NamedCredentials from '../../integrations/NamedCredentials/NamedCredentials';
import TenantManagement from '../../platform/TenantManagement/TenantManagement';
import TenantDomains from '../../platform/TenantDomains/TenantDomains';
import TenantRecoveryPanel from '../../platform/TenantRecoveryPanel/TenantRecoveryPanel';
import TenantUsagePanel from '../../platform/TenantUsagePanel/TenantUsagePanel';
import DeveloperAccountSettings from '../../settings/DeveloperAccountSettings/DeveloperAccountSettings';
import SettingsViewRow from '../../settings/SettingsViewRow/SettingsViewRow';
import ApprovalProcessManager from '../../automation/ApprovalProcessManager/ApprovalProcessManager';
import { standardPageComponents } from '../../components/Catalog/index';
import EmbeddedDashboard from '../../pages/EmbeddedDashboard/EmbeddedDashboard';
import { inspectPageDependencies } from '../../pages/PageRuntime/pageDependencies';
import {
  canvasDimensionsForOrientation,
  canvasBoundPosition,
  canvasOrientation,
  canvasScaleToFitWidth,
  canvasUnitsFromScreenDelta
} from '../../pages/PageRuntime/pageCanvas';
import {
  createComponentPreviewProps,
  getPageBuilderComponentCategories,
  pageBuilderPaletteCategories
} from '../../builders/PageBuilder/pageBuilderPalette';
import { type ObjectMetadata, type FieldMetadata, type PageLayoutMetadata, type RecordTypeMetadata } from '../../metadata/Definitions/metadata';



/** Respect administrator-provided labels; humanise only unconfigured API-name fallbacks. */
function displayFieldLabel(field: FieldMetadata): string {
  const label = field.label?.trim();
  if (label && label !== field.apiName) return label;
  const source = (label || field.apiName).replace(/__c$/i, '');
  return source.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ').trim();
}

export function RecordFormDialog({
  object,
  objects,
  activeRecordTypes,
  selectedRecordTypeId,
  profileId,
  selectedLayout,
  authoredDynamicFields = false,
  fieldAccess,
  userRoles,
  formValues,
  recordId,
  lookupRecords,
  searchLookupRecords,
  formError,
  saving,
  editing,
  actionAllowed,
  embedded = false,
  extraFields,
  onChange: onFieldChange,
  onClose,
  onSubmit
}: {
  object: ObjectMetadata;
  objects: ObjectMetadata[];
  activeRecordTypes: RecordTypeMetadata[];
  selectedRecordTypeId: string;
  profileId: string;
  selectedLayout: PageLayoutMetadata | undefined;
  authoredDynamicFields?: boolean;
  fieldAccess: Record<string, { read: boolean; edit: boolean }>;
  userRoles: Array<{id:string;name:string}>;
  formValues: Record<string, unknown>;
  recordId?: string|null;
  lookupRecords: Record<string, RecordData[]>;
  searchLookupRecords: (targetObject:string,term:string)=>Promise<RecordData[]>;
  formError: string;
  saving: boolean;
  editing: boolean;
  actionAllowed: boolean;
  embedded?: boolean;
  extraFields?: ReactNode;
  onChange: (apiName: string, value: unknown) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isPhoneViewport = useRuntimeFormFactor() === 'Phone';
  // Only user edits mark the form dirty, so defaults loaded after mount never trigger the warning.
  const dirtyRef = useRef(false);
  const onChange = useCallback((apiName: string, value: unknown) => {
    dirtyRef.current = true;
    onFieldChange(apiName, value);
  }, [onFieldChange]);
  const requestClose = useCallback(() => {
    if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }, [onClose]);
  // A save that finishes without an error leaves nothing unsaved (matters when the form stays open).
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (wasSavingRef.current && !saving && !formError) dirtyRef.current = false;
    wasSavingRef.current = saving;
  }, [saving, formError]);
  const [lookupDialogField, setLookupDialogField] = useState<FieldMetadata | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupSearchResults,setLookupSearchResults]=useState<RecordData[]|null>(null);
  const [lookupSearchBusy,setLookupSearchBusy]=useState(false);
  const [lookupSearchError,setLookupSearchError]=useState('');
  const [includeNonmatchingOptionalLookupResults, setIncludeNonmatchingOptionalLookupResults] = useState(false);
  const [imageUploadError,setImageUploadError]=useState('');
  const [imageUploading,setImageUploading]=useState(false);
  useEffect(()=>{
    const targetObject=lookupDialogField?.relationship?.targetObject;
    const term=lookupQuery.trim();
    if(!targetObject||term.length<2){
      setLookupSearchResults(null);
      setLookupSearchBusy(false);
      setLookupSearchError('');
      return;
    }
    let active=true;
    setLookupSearchResults(null);
    const timer=window.setTimeout(()=>{
      setLookupSearchBusy(true);
      setLookupSearchError('');
      void searchLookupRecords(targetObject,term).then(results=>{
        if(active)setLookupSearchResults(results);
      }).catch(failure=>{
        if(active)setLookupSearchError(failure instanceof Error?failure.message:'Unable to search lookup records');
      }).finally(()=>{
        if(active)setLookupSearchBusy(false);
      });
    },200);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[lookupDialogField?.apiName,lookupQuery,searchLookupRecords]);
  const layoutFieldNames = selectedLayout?.sections.flatMap((section) => section.fieldApiNames) ?? [];
  const requiredOnLayout=new Set(selectedLayout?.sections.flatMap(
    section=>section.requiredFieldApiNames??[])??[]);
  const readOnlyOnLayout=new Set(selectedLayout?.sections.flatMap(
    section=>section.readOnlyFieldApiNames??[])??[]);
  const visibleFields = object.fields.filter((field) => !field.formula
    && !field.dataType.toLocaleLowerCase().startsWith('auto number')
    && fieldAccess[`${object.apiName}.${field.apiName}`]?.read
    && (!selectedLayout || layoutFieldNames.includes(field.apiName) || (!authoredDynamicFields&&field.required)))
    .map(field=>requiredOnLayout.has(field.apiName)&&!readOnlyOnLayout.has(field.apiName)
      ?{...field,required:true}:field);
  const unplacedRequiredFields = visibleFields.filter((field) => field.required && !layoutFieldNames.includes(field.apiName));
  const allowedPicklistValues = (field: FieldMetadata, recordTypeId = selectedRecordTypeId, values = formValues) => {
    const recordTypeValues = object.recordTypes?.find((recordType) => recordType.id === recordTypeId)?.picklistValues?.[field.apiName];
    const valueSet = recordTypeValues ?? field.picklistValues ?? [];
    if (!field.controllerFieldApiName) return valueSet;
    const controller = object.fields.find((item) => item.apiName === field.controllerFieldApiName);
    const controllerValue = values[field.controllerFieldApiName]
      ?? (editing ? '' : controller?.defaultValue ?? (controller?.dataType === 'Checkbox' ? false : ''));
    if (controllerValue === undefined || controllerValue === null || controllerValue === '') return [];
    return (field.valueSettings?.[String(controllerValue)] ?? []).filter((value) => valueSet.includes(value));
  };
  const changeFieldValue = (apiName: string, value: unknown) => {
    onChange(apiName, value);
    const nextValues = { ...formValues, [apiName]: value };
    object.fields.filter((field) => field.controllerFieldApiName === apiName).forEach((field) => {
      const currentValue = formValues[field.apiName];
      if (currentValue !== undefined && currentValue !== null && currentValue !== '') {
        const allowedValues = allowedPicklistValues(field, selectedRecordTypeId, nextValues);
        if (field.dataType === 'Multi-Select Picklist') {
          const currentValues = String(currentValue).split(';').filter(Boolean);
          const retainedValues = currentValues.filter((item) => allowedValues.includes(item));
          if (retainedValues.length !== currentValues.length) onChange(field.apiName, retainedValues.join(';'));
        } else if (!allowedValues.includes(String(currentValue))) {
          onChange(field.apiName, '');
        }
      }
    });
  };
  const uploadInlineImage=async(field:FieldMetadata,file:File)=>{
    setImageUploadError('');
    if(!recordId){
      setImageUploadError('Save this record before adding inline images.');
      return;
    }
    if(file.size<1||file.size>1024*1024){
      setImageUploadError('Inline images must be no larger than 1 MB.');
      return;
    }
    setImageUploading(true);
    try{
      const dataUrl=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();
        reader.onerror=()=>reject(reader.error??new Error('Unable to read the selected image'));
        reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):
          reject(new Error('Unable to read the selected image'));
        reader.readAsDataURL(file);
      });
      const contentBase64=dataUrl.slice(dataUrl.indexOf(',')+1);
      const saved=await apiRequest<{url:string}>('/files/inline-images',{
        method:'POST',
        body:JSON.stringify({objectApi:object.apiName,recordId,fieldApi:field.apiName,
          name:file.name,contentType:file.type,contentBase64})
      });
      const alt=file.name.replace(/[&"<>]/g,char=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[char]??char));
      const value=String(formValues[field.apiName]??'');
      onChange(field.apiName,`${value}${value?'\n':''}<p><img src="${saved.url}" alt="${alt}"></p>`);
    }catch(error){
      setImageUploadError(error instanceof Error?error.message:'Unable to upload inline image');
    }finally{
      setImageUploading(false);
    }
  };
  const lookupDisplayFields = (field: FieldMetadata) => {
    const targetObject = objects.find((item) => item.apiName === field.relationship?.targetObject);
    if (!targetObject) return [];
    const configuredFields = isPhoneViewport
      ? targetObject.searchLayouts?.lookupPhoneDialog ?? targetObject.searchLayouts?.lookupDialog
      : targetObject.searchLayouts?.lookupDialog;
    const fieldNames = configuredFields ?? [];
    const selectedFields = fieldNames.map((name) => targetObject.fields.find((item) => item.apiName === name))
      .filter((item): item is FieldMetadata => Boolean(item && fieldAccess[`${targetObject.apiName}.${item.apiName}`]?.read));
    return configuredFields !== undefined ? selectedFields : targetObject.fields
      .filter((item) => (item.apiName === 'Name' || item.apiName === 'Email')
        && fieldAccess[`${targetObject.apiName}.${item.apiName}`]?.read)
      .slice(0, 2);
  };
  const lookupCompactFields = (field: FieldMetadata) => {
    const targetObject = objects.find((item) => item.apiName === field.relationship?.targetObject);
    const selectedRecord = (lookupRecords[targetObject?.apiName ?? ''] ?? []).find((record) =>
      record.Id === formValues[field.apiName]);
    const relatedRecordTypeId = String(selectedRecord?.RecordTypeId
      ?? targetObject?.recordTypes?.find((item) => item.active && item.isDefault)?.id
      ?? targetObject?.recordTypes?.find((item) => item.active)?.id
      ?? 'master');
    const compactLayout = targetObject ? compactLayoutForRecord(targetObject, relatedRecordTypeId, profileId) : undefined;
    return (compactLayout?.fieldApiNames ?? [])
      .map((name) => targetObject?.fields.find((item) => item.apiName === name))
      .filter((item): item is FieldMetadata => Boolean(item && fieldAccess[`${targetObject?.apiName}.${item.apiName}`]?.read));
  };
  const lookupRecordLabel = (field: FieldMetadata, item: RecordData) => {
    const displayFields = lookupDisplayFields(field);
    return displayFields.map((displayField) => item[displayField.apiName])
      .filter((itemValue) => itemValue !== undefined && itemValue !== null && itemValue !== '')
      .map(String).join(' · ') || String(item.Name ?? item.Email ?? item.Id);
  };
  const openLookupDialog = (field: FieldMetadata) => {
    setLookupDialogField(field);
    setLookupQuery('');
    setLookupSearchResults(null);
    setLookupSearchError('');
    setIncludeNonmatchingOptionalLookupResults(false);
  };
  const renderField = (field: FieldMetadata) => {
    const rawValue = formValues[field.apiName] ?? (editing ? '' : field.defaultValue);
    const value = rawValue === undefined || rawValue === null ? '' : String(rawValue);
    const dataType = field.dataType.toLocaleLowerCase();
    const helpTextId = `record-field-help-${field.apiName}`;
    const common = { id: `record-field-${field.apiName}`, name: field.apiName, required: field.required && !readOnlyOnLayout.has(field.apiName), disabled: saving || !fieldAccess[`${object.apiName}.${field.apiName}`]?.edit
      || readOnlyOnLayout.has(field.apiName), 'aria-describedby': field.helpText ? helpTextId : undefined };
    const helpText = field.helpText ? <small className="field-help-text" id={helpTextId}>{field.helpText}</small> : null;
    if(dataType==='file')return <div className="form-label" key={field.apiName}>
      <label htmlFor={common.id}>{displayFieldLabel(field)}
        {field.required&&<b aria-hidden="true"> *</b>}</label>
      <TenantFilePicker value={value} disabled={common.disabled}
        onChange={assetRef=>onChange(field.apiName,assetRef)}/>
      {helpText}
    </div>;
    if(dataType==='image')return <div className="form-label" key={field.apiName}>
      <label htmlFor={common.id}>{displayFieldLabel(field)}
        {field.required&&<b aria-hidden="true"> *</b>}</label>
      <TenantMediaPicker value={value} disabled={common.disabled}
        assetOnly onChange={assetRef=>onChange(field.apiName,assetRef)}/>
      {helpText}
    </div>;
    if (dataType === 'checkbox') return <div key={field.apiName}>
      <label className="record-checkbox">
        <input {...common} type="checkbox" checked={Boolean(rawValue ?? false)} onChange={(event) => changeFieldValue(field.apiName, event.target.checked)} />
        <span>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}</span>
      </label>
      {helpText}
    </div>;
    if (field.dataType === 'Geolocation') {
      const coordinates = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
        ? Object.fromEntries(Object.entries(rawValue))
        : {};
      const updateCoordinate = (coordinate: 'latitude' | 'longitude', input: string) => {
        const next = {
          ...coordinates,
          [coordinate]: input === '' ? null : Number(input)
        };
        onChange(field.apiName, next.latitude == null && next.longitude == null ? null : next);
      };
      return <fieldset className="form-label" key={field.apiName}>
        <legend>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}</legend>
        <div className="form-options">
          <label className="form-label">Latitude
            <input className="form-control" type="number" min="-90" max="90" step="any"
              aria-label={`${displayFieldLabel(field)} latitude`} required={common.required}
              disabled={saving || !fieldAccess[`${object.apiName}.${field.apiName}`]?.edit || readOnlyOnLayout.has(field.apiName)}
              value={coordinates.latitude == null ? '' : String(coordinates.latitude)}
              onChange={(event) => updateCoordinate('latitude', event.target.value)} />
          </label>
          <label className="form-label">Longitude
            <input className="form-control" type="number" min="-180" max="180" step="any"
              aria-label={`${displayFieldLabel(field)} longitude`} required={common.required}
              disabled={saving || !fieldAccess[`${object.apiName}.${field.apiName}`]?.edit || readOnlyOnLayout.has(field.apiName)}
              value={coordinates.longitude == null ? '' : String(coordinates.longitude)}
              onChange={(event) => updateCoordinate('longitude', event.target.value)} />
          </label>
        </div>
        {helpText}
      </fieldset>;
    }
    if (field.dataType === 'Address') {
      const address = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
        ? rawValue as Record<string, unknown> : {};
      const components = [
        ['street', 'Street'], ['city', 'City'], ['state', 'State/Province'],
        ['postalCode', 'Postal Code'], ['country', 'Country']
      ] as const;
      return <fieldset className="form-label" key={field.apiName}>
        <legend>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}</legend>
        {components.map(([apiName, label]) => <label className="form-label" key={apiName}>
          {label}
          <input className="form-control" type="text" maxLength={{
            street: 255, city: 40, state: 80, postalCode: 20, country: 80
          }[apiName]} aria-label={`${displayFieldLabel(field)} ${label}`}
            required={common.required && apiName === 'street'}
            disabled={common.disabled} value={typeof address[apiName] === 'string' ? address[apiName] as string : ''}
            onChange={(event) => {
              const next = { ...address, [apiName]: event.target.value || null };
              onChange(field.apiName, Object.values(next).every((item) => item === null || item === '')
                ? null : next);
            }} />
        </label>)}
        {helpText}
      </fieldset>;
    }
    if (field.relationship) {
      const options = lookupRecords[field.relationship.targetObject] ?? [];
      const targetObject = objects.find((item) => item.apiName === field.relationship?.targetObject);
      const requiredFilters = object.relatedLookupFilters?.filter((filter) => filter.fieldApiName === field.apiName && filter.required) ?? [];
      const lookupFilterLogic = object.relatedLookupFilterLogic?.[field.apiName] ?? 'All';
      const filteredOptions = options.filter((item) => matchesLookupFilterGroup(item, requiredFilters, formValues, lookupFilterLogic));
      const selectedRecord = options.find((item) => item.Id === value);
      const selectedMatchesFilters = filteredOptions.some((item) => item.Id === value);
      const selectedCompactFields = lookupCompactFields(field);
      return <div className="form-label" key={field.apiName}><span>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}</span>
        <div className="lookup-picker-control">
          <input className="form-control" id={common.id} name={common.name} aria-label={displayFieldLabel(field)}
            value={selectedRecord ? lookupRecordLabel(field, selectedRecord) : ''}
            placeholder={targetObject ? `Search ${targetObject.label}…` : 'Related object unavailable'}
            readOnly aria-readonly="true" required={common.required && !value} disabled={common.disabled}
            onClick={() => { if (!common.disabled && targetObject) openLookupDialog(field); }} />
          <button type="button" className="btn lookup-picker-button" disabled={common.disabled || !targetObject}
            aria-label={`Search ${targetObject?.label ?? 'related records'} for ${displayFieldLabel(field)}`}
            onClick={() => { if (targetObject) openLookupDialog(field); }}>
            <Search size={14} />Search
          </button>
          {value && !common.disabled && <button type="button" className="btn lookup-picker-clear" aria-label={`Clear ${displayFieldLabel(field)}`}
            disabled={common.required} onClick={() => onChange(field.apiName, null)}><X size={14} /></button>}
        </div>
        {selectedRecord && selectedCompactFields.length > 0 && <div className="lookup-selected-card" aria-label={`${targetObject?.label ?? 'Related record'} compact details`}>
          {selectedCompactFields.map((compactField) => <div key={compactField.apiName}><small>{compactField.label}</small><strong>{formatRecordValue(selectedRecord[compactField.apiName])}</strong></div>)}
        </div>}
        {selectedRecord && !selectedMatchesFilters && <small className="lookup-filter-warning">The selected record does not match the required lookup filter. Choose a matching record to continue.</small>}
        {helpText}
      </div>;
    }
    // The native reporting manager is edited using the secure User identity picker.
    if (object.apiName === 'User' && field.apiName === 'ReportsToId') return null;
    if (object.apiName === 'User' && field.apiName === 'UserRoleId') return <label className="form-label" key={field.apiName}>User Role
      <select className="form-control" value={value} disabled title="Assign roles through Setup → Users & Permissions → Users & Assignments">
        <option value="">Manage in Users & Assignments</option>{userRoles.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
      </select></label>;
    if (dataType === 'picklist') return <label className="form-label" htmlFor={common.id} key={field.apiName}>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}
      <select className="form-control" {...common} value={value} onChange={(event) => changeFieldValue(field.apiName, event.target.value)}>
        <option value="" disabled={common.required}>{field.required ? 'Select a value…' : '— None —'}</option>
        {(() => {
          const picklistValues = allowedPicklistValues(field);
          return <>
            {value && !picklistValues.includes(value) && <option value={value}>{value}</option>}
            {picklistValues.map((item) => <option key={item} value={item}>{item}</option>)}
          </>;
        })()}
      </select>
      {helpText}
    </label>;
    if (dataType === 'multi-select picklist') return <label className="form-label" htmlFor={common.id} key={field.apiName}>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}
      <select className="form-control" {...common} multiple value={value.split(';').filter(Boolean)} onChange={(event) => changeFieldValue(field.apiName, Array.from(event.currentTarget.selectedOptions, (option) => option.value).join(';'))}>
        {allowedPicklistValues(field).map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <small>Select multiple values with Ctrl or Command.</small>
      {helpText}
    </label>;
    // Render legacy connector configuration as editable key/value fields, never raw JSON.
    // Field names come from the saved configuration metadata, not provider-specific code.
    if (object.apiName === 'UneConnector__c' && field.apiName === 'Configuration__c') {
      let configuration: Record<string, unknown> = {};
      try {
        const decoded: unknown = value.trim() ? JSON.parse(value) : {};
        if (!decoded || Array.isArray(decoded) || typeof decoded !== 'object') throw new Error('Invalid connector configuration');
        configuration = decoded as Record<string, unknown>;
      } catch {
        return <div className="form-label record-form-wide" key={field.apiName} role="alert">
          Configuration cannot be edited because its saved format is invalid. No values have been changed.
        </div>;
      }
      const entries = Object.entries(configuration);
      const updateConfiguration = (key: string, nextValue: string) => {
        onChange(field.apiName, JSON.stringify({ ...configuration, [key]: nextValue }));
      };
      return <fieldset className="connector-config-fields record-form-wide" key={field.apiName} disabled={common.disabled}>
        <legend>{displayFieldLabel(field)}</legend>
        {entries.length ? entries.map(([key, fieldValue]) => {
          const label = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
          return <label className="connector-config-row" key={key}>
            <span>{label}</span>
            <input className="form-control" type="text" value={fieldValue == null ? '' : String(fieldValue)}
              onChange={(event) => updateConfiguration(key, event.target.value)} />
          </label>;
        }) : <p className="connector-config-empty">No configuration fields have been defined for this connector.</p>}
        {helpText}
      </fieldset>;
    }
    if (dataType.includes('text area') || dataType.includes('long text')) return <div className="form-label record-form-wide" key={field.apiName}>
      <label htmlFor={common.id}>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}</label>
      <textarea className="form-control" {...common} maxLength={['long text area', 'rich text area'].includes(dataType) ? 131072 : undefined} value={value} onChange={(event) => onChange(field.apiName, event.target.value)} />
      {dataType==='rich text area'&&<div className="record-rich-text-tools">
        <label className="btn" aria-disabled={common.disabled||imageUploading||!recordId}>
          {imageUploading?'Uploading image…':'Add inline image'}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden disabled={common.disabled||imageUploading||!recordId}
            onChange={event=>{
              const file=event.currentTarget.files?.[0];
              event.currentTarget.value='';
              if(file)void uploadInlineImage(field,file);
            }}/>
        </label>
        {!recordId&&<small>Save the record before adding inline images.</small>}
        {imageUploadError&&<small role="alert">{imageUploadError}</small>}
      </div>}
      {helpText}
    </div>;
    const type = dataType === 'date' ? 'date'
      : dataType.includes('datetime') ? 'datetime-local'
        : dataType === 'time' ? 'time'
        : dataType === 'email' ? 'email'
          : dataType === 'url' ? 'url'
            : dataType === 'phone' ? 'tel'
              : dataType.startsWith('number') || dataType.startsWith('currency') || dataType.startsWith('percent') ? 'number'
                : 'text';
    const numericFormat = field.dataType.match(/^(?:Number|Currency|Percent)\((\d+),\s*(\d+)\)$/);
    const numericMaximum = numericFormat
      ? 10 ** (Number(numericFormat[1]) - Number(numericFormat[2])) - 10 ** -Number(numericFormat[2])
      : undefined;
    const textMaximum = field.dataType.match(/^Text\((\d+)\)$/)?.[1];
    return <div className="form-label" key={field.apiName}>
      <label htmlFor={common.id}>{displayFieldLabel(field)}{field.required && <b aria-hidden="true"> *</b>}</label>
      <input className="form-control" {...common} type={type}
        min={numericMaximum === undefined ? undefined : -numericMaximum}
        max={numericMaximum}
        step={numericFormat ? (Number(numericFormat[2]) ? 10 ** -Number(numericFormat[2]) : 1) : type === 'number' ? 'any' : type === 'time' ? 1 : undefined}
        maxLength={textMaximum ? Number(textMaximum) : field.dataType === 'Text' ? 255 : undefined}
        value={value}
        onChange={(event) => onChange(field.apiName, type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} />
      {type==='text' && acceptsTenantImageAsset(field) && <details className="component-optional-settings">
        <summary className="properties-help">Use tenant image asset</summary>
        <TenantMediaPicker value={typeof value==='string'?value:''}
          onChange={next=>onChange(field.apiName,next)} disabled={common.disabled}/>
      </details>}
      {helpText}
    </div>;
  };
  return <div className={embedded ? "record-form-inline" : "record-form-backdrop"} role="presentation" onMouseDown={(event) => { if (!embedded && event.target === event.currentTarget && !saving) requestClose(); }}>
    <section className="record-form-dialog surface" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="record-form-title" onKeyDown={(event) => { if (event.key === 'Escape' && !saving && !lookupDialogField) requestClose(); }}>
      <header><div><div className="eyebrow">{object.label}</div><h2 id="record-form-title">{editing ? 'Edit Record' : `New ${object.label}`}</h2></div>
        <button className="icon-button" aria-label="Close" onClick={requestClose} disabled={saving}><X size={16} /></button></header>
      <form onSubmit={onSubmit}>
        {activeRecordTypes.length > 1 && <label className="form-label">Record Type
          <select className="form-control" value={selectedRecordTypeId} disabled={saving} onChange={(event) => {
            const nextRecordTypeId = event.target.value;
            onChange('RecordTypeId', nextRecordTypeId);
            const nextRecordValues = { ...formValues };
            object.fields.filter((field) => field.dataType === 'Picklist' || field.dataType === 'Multi-Select Picklist').forEach((field) => {
              const allowed = allowedPicklistValues(field, nextRecordTypeId, nextRecordValues);
              const current = nextRecordValues[field.apiName];
              if (current !== undefined && current !== null && current !== '') {
                if (field.dataType === 'Multi-Select Picklist') {
                  const selectedValues = String(current).split(';').filter(Boolean);
                  const retainedValues = selectedValues.filter((value) => allowed.includes(value));
                  if (retainedValues.length !== selectedValues.length) {
                    nextRecordValues[field.apiName] = retainedValues.join(';');
                    onChange(field.apiName, retainedValues.join(';'));
                  }
                } else if (!allowed.includes(String(current))) {
                  nextRecordValues[field.apiName] = '';
                  onChange(field.apiName, null);
                }
              }
            });
          }}>
            {activeRecordTypes.map((recordType) => <option key={recordType.id} value={recordType.id}>{recordType.label}</option>)}
          </select>
        </label>}
        {selectedLayout?.sections.length ? <>
          {selectedLayout.sections.map((section) => {
          const sectionFields = section.fieldApiNames.map((name) => visibleFields.find((field) => field.apiName === name)).filter((field): field is FieldMetadata => Boolean(field));
          return <section className="record-form-section" key={section.id}><h3>{section.label}</h3><div className={`record-form-grid columns-${section.columns}`}>{sectionFields.map(renderField)}</div></section>;
          })}
          {unplacedRequiredFields.length > 0 && <section className="record-form-section"><h3>Required Fields</h3><div className="record-form-grid">{unplacedRequiredFields.map(renderField)}</div></section>}
        </> : <div className="record-form-grid">{visibleFields.map(renderField)}</div>}
        {extraFields}
        {object.apiName === 'User' && !editing && <label className="form-label">Initial Password (12+ characters)
          <input className="form-control" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={saving}
            value={String(formValues.Password ?? '')} onChange={(event) => onChange('Password',event.target.value)} />
          <small>Stored as a password hash. Never shown in records.</small>
        </label>}
        {formError && <div className="records-message" role="alert">{formError}</div>}
        {!actionAllowed && <div className="records-message" role="alert">This action is not enabled for the selected page layout.</div>}
        <footer><button type="button" className="btn" onClick={requestClose} disabled={saving}>Cancel</button><button type="submit" className="btn btn-brand" disabled={saving || !actionAllowed}>{saving ? 'Saving…' : 'Save'}</button></footer>
      </form>
    </section>
    {lookupDialogField && (() => {
      const targetObject = objects.find((item) => item.apiName === lookupDialogField.relationship?.targetObject);
      const initialOptions = lookupRecords[lookupDialogField.relationship?.targetObject ?? ''] ?? [];
      const options = lookupQuery.trim().length>=2 ? lookupSearchResults??[] : initialOptions;
      const requiredFilters = object.relatedLookupFilters?.filter((filter) =>
        filter.fieldApiName === lookupDialogField.apiName && filter.required) ?? [];
      const optionalFilters = object.relatedLookupFilters?.filter((filter) =>
        filter.fieldApiName === lookupDialogField.apiName && !filter.required) ?? [];
      const lookupFilterLogic = object.relatedLookupFilterLogic?.[lookupDialogField.apiName] ?? 'All';
      const filteredOptions = options.filter((item) =>
        matchesLookupFilterGroup(item, requiredFilters, formValues, lookupFilterLogic)
        && (includeNonmatchingOptionalLookupResults
          || matchesLookupFilterGroup(item, optionalFilters, formValues, lookupFilterLogic)));
      const displayFields = lookupDisplayFields(lookupDialogField);
      const configuredFields = isPhoneViewport
        ? targetObject?.searchLayouts?.lookupPhoneDialog ?? targetObject?.searchLayouts?.lookupDialog
        : targetObject?.searchLayouts?.lookupDialog;
      const searchableFields = configuredFields !== undefined ? displayFields : targetObject?.fields.filter((field) =>
        (field.apiName === 'Name' || field.apiName === 'Email')
        && fieldAccess[`${targetObject.apiName}.${field.apiName}`]?.read) ?? [];
      const query = lookupQuery.trim().toLocaleLowerCase();
      const matchingOptions = filteredOptions.filter((item) => !query || lookupSearchResults!==null
        || searchableFields.some((field)=>String(item[field.apiName]??'').toLocaleLowerCase().includes(query)));
      return <div className="lookup-dialog-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setLookupDialogField(null);
      }}>
        <section className="lookup-dialog surface" role="dialog" aria-modal="true" aria-labelledby="lookup-dialog-title"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') setLookupDialogField(null);
          }}>
          <header><div><div className="eyebrow">{targetObject?.label ?? 'Related Records'}</div>
            <h2 id="lookup-dialog-title">Select {targetObject?.label ?? 'a record'}</h2></div>
            <button type="button" className="icon-button" aria-label="Close lookup dialog" onClick={() => setLookupDialogField(null)}><X size={16} /></button>
          </header>
          <label className="lookup-dialog-search"><Search size={15} /><input autoFocus aria-label={`Search ${targetObject?.label ?? 'records'}`}
            value={lookupQuery} onChange={(event) => setLookupQuery(event.target.value)} placeholder={`Search this ${targetObject?.label.toLocaleLowerCase() ?? 'list'}…`} /></label>
          {optionalFilters.length > 0 && <label className="checkbox-row">
            <input type="checkbox" checked={includeNonmatchingOptionalLookupResults}
              onChange={(event) => setIncludeNonmatchingOptionalLookupResults(event.target.checked)} />
            <span>Include records outside optional lookup filters</span>
          </label>}
          {lookupSearchBusy&&<p role="status">Searching records…</p>}
          {lookupSearchError&&<p className="records-message" role="alert">{lookupSearchError}</p>}
          {matchingOptions.length ? <div className="lookup-dialog-results" role="listbox" aria-label={`${targetObject?.label ?? 'Record'} results`}>
            {matchingOptions.map((item) => <button type="button" role="option" aria-selected={String(formValues[lookupDialogField.apiName] ?? '') === item.Id}
              key={item.Id} className="lookup-dialog-result" onClick={() => {
                onChange(lookupDialogField.apiName, item.Id);
                setLookupDialogField(null);
              }}>
              {searchableFields.map((field) => <span key={field.apiName}><small>{displayFieldLabel(field)}</small>{formatRecordValue(item[field.apiName])}</span>)}
              {!searchableFields.length && <span>{String(item.Name ?? item.Email ?? item.Id)}</span>}
            </button>)}
          </div> : <div className="records-empty">{lookupSearchBusy?'Searching…':lookupQuery.trim().length<2
            ?'Type at least two characters to search records.'
            :initialOptions.length?'No matching records satisfy the search and required lookup filters.'
              :'No records are available for this lookup.'}</div>}
          <footer><button type="button" className="btn" onClick={() => setLookupDialogField(null)}>Cancel</button></footer>
        </section>
      </div>;
    })()}
  </div>;
}
