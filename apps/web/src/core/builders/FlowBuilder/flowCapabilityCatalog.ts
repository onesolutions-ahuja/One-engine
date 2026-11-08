import type {FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';

export type FlowCapabilityCatalog = {
  registryVersion:number;
  flowTypes:Array<{type:FlowDefinitionMetadata['flowType'];description:string;
    createEnabled:boolean;validateEnabled:boolean;debugEnabled:boolean}>;
  elements:Array<{
    type:string;group:string;icon:string;builderEnabled:boolean;beforeSaveAllowed:boolean;
    configSchemaKey:string;validatorKey:string;runtimeHandlerKey:string;
    debugBehavior:'execute'|'simulate'|'unsupported';
    allowedFlowTypes:string[];builderFlowTypes:string[];
    properties:Array<{name:string;valueType:string;required:boolean}>;
  }>;
};

export const flowCreateOptions=(catalog:FlowCapabilityCatalog|null)=>
  (catalog?.flowTypes??[]).filter(type=>type.createEnabled&&type.validateEnabled);

/** One capability check replaces independent toolbox and editor allow-lists. */
export function flowElementAvailable(catalog:FlowCapabilityCatalog|null,type:string,
  flowType:string,runWhen:unknown):boolean {
  const element=catalog?.elements.find(candidate=>candidate.type===type);
  return Boolean(element?.builderFlowTypes.includes(flowType)
    &&!(flowType==='Record-Triggered Flow'&&runWhen==='before-save'
      &&!element.beforeSaveAllowed));
}

/** The toolbox must never offer an element marked editing-only in SQL.
 * Imported, published elements can still be inspected by flowElementAvailable. */
export function flowElementInToolbox(catalog:FlowCapabilityCatalog|null,type:string,
  flowType:string,runWhen:unknown):boolean {
  return Boolean(catalog?.elements.find(item=>item.type===type)?.builderEnabled
    &&flowElementAvailable(catalog,type,flowType,runWhen));
}
