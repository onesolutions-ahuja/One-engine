// @ts-nocheck
// Object/Field metadata CRUD and wizard state transformations. No application-specific objects.
import type { ObjectMetadata, FieldMetadata, RelatedLookupFilterMetadata } from '../../metadata/Definitions/metadata';
import {suggestMetadataApiNameWithSuffix} from '../../metadata/Definitions/metadataApiNames';
export function createSetupObjectActions(ctx: any) {
 const { apiRequest, apps, setApps, customTabAppIds, setCustomTabAppIds, customTabObject, customTabStyle, formulaEditorRef, launchCustomTabWizard, navigateRoute, newFieldAllowReparenting, newFieldAutoNumberFormat, newFieldCaseSensitive, newFieldChildRelationshipName, newFieldControllerApiName, newFieldDefaultValue, newFieldDeleteBehavior, newFieldDescription, newFieldExternalId, newFieldFormula, newFieldHasDefault, newFieldHelpText, newFieldLabel, newFieldLayoutIds, newFieldLookupFilterLogic, newFieldLookupFilters, newFieldPicklistRestricted, newFieldPicklistValues, newFieldPrecision, newFieldRelationshipName, newFieldRelationshipTarget, newFieldRequired, newFieldReturnType, newFieldScale, newFieldTextLength, newFieldType, newFieldUnique, newFieldValueSettings, newObjectDescription, newObjectLabel, newObjectPluralLabel, newObjectRecordNameLabel, newObjectSettings, notify, object, objects, route, setCustomTabObject, setCustomTabStyle, setLaunchCustomTabWizard, setNewFieldAllowReparenting, setNewFieldAutoNumberFormat, setNewFieldCaseSensitive, setNewFieldChildRelationshipName, setNewFieldControllerApiName, setNewFieldDefaultValue, setNewFieldDeleteBehavior, setNewFieldDescription, setNewFieldExternalId, setNewFieldFormula, setNewFieldFormulaValidation, setNewFieldHasDefault, setNewFieldHelpText, setNewFieldLabel, setNewFieldLayoutIds, setNewFieldLookupFilterLogic, setNewFieldLookupFilters, setNewFieldPicklistRestricted, setNewFieldPicklistValues, setNewFieldPrecision, setNewFieldRelationshipName, setNewFieldRelationshipTarget, setNewFieldRequired, setNewFieldRollupChildObject, setNewFieldRollupOperation, setNewFieldRollupRelationshipField, setNewFieldRollupSourceField, setNewFieldScale, setNewFieldStage, setNewFieldTextLength, setNewFieldType, setNewFieldUnique, setNewFieldValueSettings, setNewObjectDescription, setNewObjectLabel, setNewObjectPluralLabel, setNewObjectRecordNameLabel, setNewObjectSettings, setObject, setObjectSetting, setObjects, setShowCustomTabWizard, setShowNewField, setShowNewObject, workspace } = ctx;
  const validateNewFieldFormula = async (): Promise<boolean> => {
    setNewFieldFormulaValidation({ status: 'checking', message: '' });
    try {
      const result = await apiRequest<{ valid: boolean }>(
        `/metadata/objects/${encodeURIComponent(object.apiName)}/formulas/validate`,
        { method: 'POST', body: JSON.stringify({ expression: newFieldFormula, returnType: newFieldReturnType }) }
      );
      if (!result.valid) {
        setNewFieldFormulaValidation({ status: 'invalid', message: 'Formula validation failed.' });
        return false;
      }
      setNewFieldFormulaValidation({ status: 'valid', message: 'Formula is valid.' });
      return true;
    } catch (error) {
      setNewFieldFormulaValidation({
        status: 'invalid',
        message: error instanceof Error ? error.message : 'Formula validation failed.'
      });
      return false;
    }
  };

  const insertFormulaText = (snippet: string) => {
    const editor = formulaEditorRef.current;
    const start = editor?.selectionStart ?? newFieldFormula.length;
    const end = editor?.selectionEnd ?? start;
    const nextFormula = `${newFieldFormula.slice(0, start)}${snippet}${newFieldFormula.slice(end)}`;
    setNewFieldFormula(nextFormula);
    setNewFieldFormulaValidation({ status: 'idle', message: '' });
    window.requestAnimationFrame(() => {
      editor?.focus();
      editor?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const resetNewFieldDraft = () => {
    setNewFieldType('Text');
    setNewFieldStage(0);
    setNewFieldLabel('');
    setNewFieldTextLength(255);
    setNewFieldAutoNumberFormat('REC-{0000}');
    setNewFieldPrecision(18);
    setNewFieldScale(0);
    setNewFieldDescription('');
    setNewFieldHelpText('');
    setNewFieldDefaultValue('');
    setNewFieldHasDefault(false);
    setNewFieldFormula('');
    setNewFieldFormulaValidation({ status: 'idle', message: '' });
    setNewFieldPicklistValues('');
    setNewFieldPicklistRestricted(true);
    setNewFieldControllerApiName('');
    setNewFieldValueSettings({});
    setNewFieldRelationshipTarget('');
    setNewFieldRelationshipName('');
    setNewFieldChildRelationshipName('');
    setNewFieldRollupChildObject('');
    setNewFieldRollupRelationshipField('');
    setNewFieldRollupOperation('COUNT');
    setNewFieldRollupSourceField('');
    setNewFieldDeleteBehavior('Clear');
    setNewFieldAllowReparenting(false);
    setNewFieldLookupFilters([]);
    setNewFieldLookupFilterLogic('All');
    setNewFieldRequired(false);
    setNewFieldUnique(false);
    setNewFieldExternalId(false);
    setNewFieldCaseSensitive(false);
    setNewFieldLayoutIds([]);
  };

  const newFieldApiName = suggestMetadataApiNameWithSuffix(newFieldLabel,object.fields.map((field) => field.apiName),'__c');
  const newFieldPicklistOptions = newFieldPicklistValues.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const newFieldController = object.fields.find((field) => field.apiName === newFieldControllerApiName);
  const newFieldControllerValues = newFieldController?.dataType === 'Checkbox'
    ? ['true', 'false']
    : newFieldController?.picklistValues ?? [];
  const newFieldDefaultError = (() => {
    if (!newFieldHasDefault) return '';
    if (['Number', 'Currency', 'Percent'].includes(newFieldType)) {
      const value = Number(newFieldDefaultValue);
      const fraction = newFieldDefaultValue.split('.')[1] ?? '';
      if (!Number.isFinite(value) || fraction.length > newFieldScale || Math.abs(value) >= 10 ** (newFieldPrecision - newFieldScale)) {
        return 'The default value exceeds this field’s precision or scale.';
      }
    }
    if (newFieldType === 'Text' && newFieldDefaultValue.length > newFieldTextLength) return 'The default value exceeds the configured text length.';
    if (['Picklist', 'Multi-Select Picklist'].includes(newFieldType)) {
      const values = newFieldType === 'Multi-Select Picklist' ? newFieldDefaultValue.split(';') : [newFieldDefaultValue];
      if (values.some((value) => !newFieldPicklistOptions.includes(value))
        || (newFieldType === 'Multi-Select Picklist' && new Set(values).size !== values.length)) {
        return 'Choose distinct configured values for the default.';
      }
    }
    if (newFieldType === 'Email' && newFieldDefaultValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newFieldDefaultValue)) return 'Enter a valid email default.';
    if (newFieldType === 'URL' && newFieldDefaultValue) {
      try {
        if (!['http:', 'https:'].includes(new URL(newFieldDefaultValue).protocol)) return 'Enter a valid HTTP or HTTPS URL default.';
      } catch {
        return 'Enter a valid HTTP or HTTPS URL default.';
      }
    }
    if (newFieldType === 'Date' && newFieldDefaultValue) {
      const date = new Date(`${newFieldDefaultValue}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newFieldDefaultValue) || !Number.isFinite(date.getTime())
        || date.toISOString().slice(0, 10) !== newFieldDefaultValue) return 'Enter a valid date default.';
    }
    if (newFieldType === 'Date/Time' && newFieldDefaultValue
      && (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.test(newFieldDefaultValue)
        || !Number.isFinite(Date.parse(newFieldDefaultValue)))) return 'Enter a valid date and time default.';
    if (newFieldType === 'Time' && newFieldDefaultValue
      && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(newFieldDefaultValue)) return 'Enter a valid time default.';
    return '';
  })();
  const newFieldConfigurationError = !newFieldLabel.trim()
    ? 'Enter a field label.'
    : !/^[A-Za-z][A-Za-z0-9_]*__c$/.test(newFieldApiName)
      ? 'The field label must produce a valid custom field name.'
      : object.fields.some((field) => field.apiName.toLocaleLowerCase() === newFieldApiName.toLocaleLowerCase())
        ? 'A field with this name already exists.'
        : newFieldType === 'Text' && (!Number.isInteger(newFieldTextLength) || newFieldTextLength < 1 || newFieldTextLength > 255)
          ? 'Text length must be between 1 and 255.'
          : ['Number', 'Currency', 'Percent'].includes(newFieldType)
            && (!Number.isInteger(newFieldPrecision) || newFieldPrecision < 1 || newFieldPrecision > 18
              || !Number.isInteger(newFieldScale) || newFieldScale < 0 || newFieldScale > newFieldPrecision)
              ? 'Precision must be 1–18 and scale must be between 0 and precision.'
              : newFieldType === 'Formula' && !newFieldFormula.trim()
                ? 'Enter a formula expression.'
                : ['Picklist', 'Multi-Select Picklist'].includes(newFieldType)
                  && (newFieldPicklistOptions.length === 0
                    || new Set(newFieldPicklistOptions.map((value) => value.toLocaleLowerCase())).size !== newFieldPicklistOptions.length)
                    ? 'Enter at least one unique picklist value.'
                    : newFieldType === 'Multi-Select Picklist' && newFieldPicklistOptions.some((value) => value.includes(';'))
                      ? 'Multi-select picklist values cannot contain semicolons.'
                      : Boolean(newFieldControllerApiName)
                        && (!newFieldController || !newFieldControllerValues.length)
                          ? 'Choose a controlling field with configured values.'
                          : ['Lookup Relationship', 'Master-Detail Relationship'].includes(newFieldType) && !newFieldRelationshipTarget
                            ? 'Select a related object.'
                            : ['Lookup Relationship', 'Master-Detail Relationship', 'Hierarchical Relationship'].includes(newFieldType)
                              && !/^[A-Za-z][A-Za-z0-9_]*$/.test(newFieldRelationshipName.trim()
                                || newFieldLabel.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, ''))
                              ? 'Enter a valid relationship name using letters, numbers, and underscores.'
                              : ['Lookup Relationship', 'Master-Detail Relationship', 'Hierarchical Relationship'].includes(newFieldType)
                                && !/^[A-Za-z][A-Za-z0-9_]*$/.test(newFieldChildRelationshipName.trim()
                                  || `${object.apiName.replace(/__c$/, '')}${newFieldApiName.replace(/Id$/, '')}Records`.slice(0,80))
                                ? 'Enter a valid child relationship name using letters, numbers, and underscores.'
                            : newFieldLookupFilters.some((filter) =>
                              !filter.relatedFieldApiName
                              || (filter.operator !== 'Is Null' && filter.operator !== 'Is Not Null'
                                && filter.valueMode === 'Field' && !filter.valueFieldApiName))
                              ? 'Complete each lookup filter or remove it before continuing.'
                              : newFieldDefaultError;

  const addField = async (rollupConfig?: FieldMetadata['rollup'], globalValueSetApiName?: string,
    autoNumberFormatOverride?:string) => {
    const label = newFieldLabel.trim();
    if (!label) return;
    const apiName = newFieldApiName;
    const relationshipType = newFieldType === 'Lookup Relationship' ? 'Lookup'
      : newFieldType === 'Master-Detail Relationship' ? 'Master-Detail'
        : newFieldType === 'Hierarchical Relationship' ? 'Hierarchical' : undefined;
    const relationshipTarget = relationshipType === 'Hierarchical' ? 'User' : newFieldRelationshipTarget;
    const relationshipName = label.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const dataType = newFieldType === 'Formula'
      ? `Formula(${newFieldReturnType})`
      : newFieldType === 'Roll-Up Summary' ? 'Roll-Up Summary'
      : relationshipType
        ? `${relationshipType === 'Hierarchical' ? 'Lookup' : relationshipType}(${relationshipTarget})`
        : newFieldType === 'Text' ? `Text(${newFieldTextLength})`
          : ['Number', 'Currency', 'Percent'].includes(newFieldType) ? `${newFieldType}(${newFieldPrecision}, ${newFieldScale})`
            : newFieldType;
    const field = {
      apiName,
      label,
      dataType,
      required: newFieldType === 'Master-Detail Relationship' || newFieldType === 'Auto Number'
        || (!['Formula', 'Roll-Up Summary'].includes(newFieldType) && newFieldRequired),
      unique: !['Formula', 'Roll-Up Summary', 'Auto Number', 'Text Area', 'Text (Encrypted)', 'Long Text Area', 'Rich Text Area', 'Geolocation', 'Address'].includes(newFieldType)
        && !relationshipType && newFieldUnique,
      ...(newFieldExternalId && newFieldType !== 'Roll-Up Summary' ? { externalId: true } : {}),
      ...((newFieldUnique || newFieldExternalId) && ['Text', 'Email', 'Phone'].includes(newFieldType)
        ? { caseSensitive: newFieldCaseSensitive }
        : {}),
      ...(newFieldDescription.trim() ? { description: newFieldDescription.trim() } : {}),
      ...(newFieldHelpText.trim() ? { helpText: newFieldHelpText.trim() } : {}),
      ...(newFieldType === 'Formula' ? { formula: { expression: newFieldFormula.trim(), returnType: newFieldReturnType } } : {}),
      ...(newFieldType === 'Auto Number' ? { autoNumberFormat: (autoNumberFormatOverride??newFieldAutoNumberFormat).trim() } : {}),
      ...(newFieldType === 'Roll-Up Summary' && rollupConfig ? { rollup: rollupConfig } : {}),
      ...(['Picklist', 'Multi-Select Picklist'].includes(newFieldType) ? {
        picklistValues: newFieldPicklistOptions,
        picklistRestricted: newFieldPicklistRestricted,
        ...(globalValueSetApiName ? { globalValueSetApiName } : {}),
        ...(newFieldControllerApiName ? {
          controllerFieldApiName: newFieldControllerApiName,
          valueSettings: newFieldValueSettings
        } : {})
      } : {}),
      ...(newFieldHasDefault && !['Roll-Up Summary','Auto Number'].includes(newFieldType) ? {
        defaultValue: newFieldType === 'Checkbox'
          ? newFieldDefaultValue === 'true'
          : ['Number', 'Currency', 'Percent'].includes(newFieldType)
            ? Number(newFieldDefaultValue)
            : newFieldType === 'Date/Time'
              ? new Date(newFieldDefaultValue).toISOString()
              : newFieldDefaultValue
      } : {}),
      ...(relationshipType ? { relationship: {
        type: relationshipType,
        targetObject: relationshipTarget,
        relationshipName: newFieldRelationshipName.trim() || relationshipName,
        childRelationshipName: newFieldChildRelationshipName.trim() || `${object.apiName.replace(/__c$/, '')}${newFieldApiName.replace(/Id$/, '')}Records`.slice(0,80),
        ...(relationshipType === 'Lookup' ? {
          deleteBehavior: newFieldRequired ? 'Restrict' : newFieldDeleteBehavior
        } : {}),
        ...(relationshipType === 'Master-Detail' ? { allowReparenting: newFieldAllowReparenting } : {})
      } } : {})
    };
    try {
      if (newFieldType === 'Formula' && !await validateNewFieldFormula()) return;
      const lookupFilters: RelatedLookupFilterMetadata[] = relationshipType
        ? newFieldLookupFilters.map((filter) => {
          const isNullOperator = filter.operator === 'Is Null' || filter.operator === 'Is Not Null';
          return {
            id: `lookup-filter-${crypto.randomUUID()}`,
            fieldApiName: apiName,
            relatedObject: relationshipTarget,
            relatedFieldApiName: filter.relatedFieldApiName,
            operator: filter.operator,
            value: filter.valueMode === 'Value' && !isNullOperator ? filter.value : '',
            ...(filter.valueMode === 'Field' && !isNullOperator && filter.valueFieldApiName
              ? { valueFieldApiName: filter.valueFieldApiName }
              : {}),
            required: filter.required
          };
        })
        : [];
      const payload = await apiRequest<{ object: ObjectMetadata }>(`/metadata/objects/${encodeURIComponent(object.apiName)}/fields`, {
        method: 'POST',
        headers: { 'If-Match': `"${object.revision ?? 0}"` },
        body: JSON.stringify({
          field,
          pageLayoutIds: newFieldLayoutIds,
          ...(lookupFilters.length ? { relatedLookupFilters: lookupFilters } : {}),
          ...(lookupFilters.length && newFieldLookupFilterLogic === 'Any'
            ? { relatedLookupFilterLogic: { [apiName]: newFieldLookupFilterLogic } }
            : {})
        })
      });
      setObject(payload.object);
      setObjects((current) => current.map((item) => item.apiName === payload.object.apiName ? payload.object : item));
      setShowNewField(false);
      resetNewFieldDraft();
      notify(`${label} field saved to ${object.label}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save field');
    }
  };

  const saveObject = async (nextObject: ObjectMetadata) => {
    const payload = await apiRequest<{ object: ObjectMetadata }>(`/metadata/objects/${encodeURIComponent(nextObject.apiName)}`, {
      method: 'PUT',
      headers: { 'If-Match': `"${nextObject.revision ?? 0}"` },
      body: JSON.stringify(nextObject)
    });
    setObject(payload.object);
    setObjects((current) => current.map((item) => item.apiName === payload.object.apiName ? payload.object : item));
    notify(`${payload.object.label} configuration saved`);
  };

  const refreshObject = async (apiName: string) => {
    const payload = await apiRequest<{ object: ObjectMetadata }>(`/metadata/objects/${encodeURIComponent(apiName)}`);
    setObject(payload.object);
    setObjects((current) => current.map((item) => item.apiName === payload.object.apiName ? payload.object : item));
    return payload.object;
  };

  const restoreObject = async (apiName: string): Promise<ObjectMetadata> => {
    const payload = await apiRequest<{ object: ObjectMetadata }>(
      `/metadata/objects/${encodeURIComponent(apiName)}/restore`, {method: 'POST'});
    setObjects((current: ObjectMetadata[]) => current.some((item) => item.apiName === apiName)
      ? current.map((item) => item.apiName === apiName ? payload.object : item)
      : [...current, payload.object]);
    setObject(payload.object);
    setObjectSetting('Details');
    navigateRoute({kind:'setup',workspace:'object-manager',objectApiName:apiName,setting:'Details'});
    notify(`${payload.object.label} restored`);
    return payload.object;
  };

  const deleteObject = async (apiName: string) => {
    await apiRequest<void>(`/metadata/objects/${encodeURIComponent(apiName)}`, {
      method: 'DELETE', headers: { 'If-Match': `"${object.revision ?? 0}"` }
    });
    const remaining = objects.filter((item) => item.apiName !== apiName);
    setObjects(remaining);
    if (remaining[0]) setObject(remaining[0]);
    setObjectSetting('Details');
    if (route.kind === 'setup' && route.workspace === 'object-manager' && route.objectApiName === apiName && remaining[0]) {
      navigateRoute({ kind: 'setup', workspace: 'object-manager', objectApiName: remaining[0].apiName, setting: 'Details' });
    }
    notify('Custom object deleted');
  };

  const saveField = async (field: FieldMetadata) => {
    const payload = await apiRequest<{ object: ObjectMetadata }>(`/metadata/objects/${encodeURIComponent(object.apiName)}/fields/${encodeURIComponent(field.apiName)}`, {
      method: 'PUT',
      headers: { 'If-Match': `"${object.revision ?? 0}"` },
      body: JSON.stringify(field)
    });
    setObject(payload.object);
    setObjects((current) => current.map((item) => item.apiName === payload.object.apiName ? payload.object : item));
    notify(`${field.label} field saved`);
    return payload.object;
  };

  const deleteField = async (apiName: string) => {
    const payload = await apiRequest<{ object: ObjectMetadata }>(`/metadata/objects/${encodeURIComponent(object.apiName)}/fields/${encodeURIComponent(apiName)}`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${object.revision ?? 0}"` }
    });
    setObject(payload.object);
    setObjects((current) => current.map((item) => item.apiName === payload.object.apiName ? payload.object : item));
    notify('Custom field deleted');
    return payload.object;
  };

  const createObject = async () => {
    const label = newObjectLabel.trim();
    const pluralLabel = newObjectPluralLabel.trim();
    if (!label || !pluralLabel) return;
    const apiName = suggestMetadataApiNameWithSuffix(label,objects.map((item) => item.apiName),'__c');
    if (!apiName) {
      notify('Object label must produce a valid API name');
      return;
    }
    if (newObjectSettings.recordNameType === 'Auto Number' && !newObjectSettings.recordNameFormat.trim()) {
      notify('Enter a display format for the auto-number record name');
      return;
    }

    const shouldLaunchTabWizard = launchCustomTabWizard;
    try {
      const payload = await apiRequest<{ object: ObjectMetadata }>('/metadata/objects', {
        method: 'POST',
        body: JSON.stringify({
          apiName, label, pluralLabel, kind: 'Custom Object',
          description: newObjectDescription.trim(),
          settings: newObjectSettings,
          fields: [{
            apiName: 'Name',
            label: newObjectRecordNameLabel.trim() || `${label} Name`,
            dataType: newObjectSettings.recordNameType === 'Auto Number' ? 'AutoNumber' : 'Text(80)',
            required: true,
            unique: false,
            ...(newObjectSettings.recordNameType === 'Auto Number'
              ? { autoNumberFormat: newObjectSettings.recordNameFormat.trim() }
              : {})
          }]
        })
      });
      setObjects((current) => [...current, payload.object]);
      setObject(payload.object);
      setObjectSetting('Details');
      navigateRoute({ kind: 'setup', workspace: 'object-manager', objectApiName: payload.object.apiName, setting: 'Details' });
      setShowNewObject(false);
      setNewObjectLabel('');
      setNewObjectPluralLabel('');
      setNewObjectDescription('');
      setNewObjectRecordNameLabel('');
      setLaunchCustomTabWizard(false);
      setNewObjectSettings({
        allowReports: true,
        allowActivities: false,
        trackFieldHistory: false,
        allowInChatter: false,
        deploymentStatus: 'In Development',
        recordNameType: 'Text',
        recordNameFormat: ''
      });
      if (shouldLaunchTabWizard) {
        setCustomTabObject(payload.object);
        setCustomTabStyle('Blue');
        setCustomTabAppIds([]);
        setShowCustomTabWizard(true);
      }
      notify(`${label} object created`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to create object');
    }
  };

  const saveCustomTab = async () => {
    if (!customTabObject) return;
    try {
      // Persist tab metadata through the existing Object Manager revision check.
      await saveObject({ ...customTabObject, customTab: { style: customTabStyle } });
      // Refresh the revision before attempting any retry after an app save failure.
      setCustomTabObject(await refreshObject(customTabObject.apiName));
      // App navigation remains app metadata, permission-checked through App Runtime.
      // Only explicitly selected apps gain the tab; no tenant-wide navigation bypass.
      for (const app of apps.filter(item => customTabAppIds.includes(item.apiName))) {
        if (app.navigationItems.includes(customTabObject.apiName)) continue;
        const nextApp = {
          ...app,
          navigationItems: [...app.navigationItems, customTabObject.apiName],
          navigationOrder: [...app.navigationOrder,
            { type:'Object', apiName:customTabObject.apiName }]
        };
        const response=await apiRequest(`/metadata/apps/${encodeURIComponent(app.apiName)}`,{
          method:'PUT',body:JSON.stringify(nextApp)
        });
        const saved=response.app;
        setApps(current=>current.map(item=>item.apiName===saved.apiName?saved:item));
      }
      setCustomTabAppIds([]);
      setShowCustomTabWizard(false);
      setCustomTabObject(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save custom tab and app navigation');
    }
  };


 return { validateNewFieldFormula, insertFormulaText, resetNewFieldDraft, newFieldApiName, newFieldPicklistOptions, newFieldController, newFieldControllerValues, newFieldDefaultError, newFieldConfigurationError, addField, saveObject, refreshObject, deleteObject, restoreObject, saveField, deleteField, createObject, saveCustomTab };
}
