/** The same pure Property Engine contract is compiled for browser and server. */
export {
 PROPERTY_SCHEMA_VERSION, propertyKinds, isPropertyRecord, sortComponentSettings,
 availableComponentSettings, mergeComponentSettings, resolveComponentSettings, componentSettingAvailable,
 componentSettingIssues, validateComponentSettings, validateComponentSetting,
 validateComponentDefinitions
} from '../../../../../server/src/system-support/component-property-contract';
export type {ComponentSettingKind,ComponentSettingDefinition,PropertyDevice,PropertyIssue}
 from '../../../../../server/src/system-support/component-property-contract';
