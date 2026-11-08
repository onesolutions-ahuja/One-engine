import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** RollupSummaryField: rollup metadata descriptor. */
export const RollupSummaryDefinition:FieldTypeDefinition=Object.freeze({
 name:'RollupSummaryField',dataType:'rollup',kind:'computed',
 storage:'record'
});

/** Render persisted SQL rollup values without a second aggregation engine. */
export function readRollupSummaryField(sourceType:string|null|undefined,dateValue:string|null,dateTimeValue:Date|string|null,numberValue:string|null):string|number|null{
 if(sourceType==='date')return dateValue;
 if(sourceType==='datetime')return dateTimeValue===null?null:new Date(dateTimeValue).toISOString();
 return numberValue===null?null:Number(numberValue);
}
