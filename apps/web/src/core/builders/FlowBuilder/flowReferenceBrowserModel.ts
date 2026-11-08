import type { FieldMetadata, FlowDefinitionMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';
import type { ReferenceGroup, ReferenceOption } from '../../../component-libraries/shared/primitives/ReferenceBrowser/ReferenceBrowser';
import { compatibleFlowValue, flowReferenceChoices, referenceName, type FlowReferenceSymbol } from './flowReferenceCatalog';

/** One metadata-backed catalog for Flow's @ picker, not a POS-specific field list. */
export function flowReferenceBrowserGroups(
  flow: FlowDefinitionMetadata, elementId: number, objects: readonly ObjectMetadata[],
  target?: FieldMetadata, targetObjectApiName?: string, symbol?: FlowReferenceSymbol
): {groups: ReferenceGroup[]; directOptions: ReferenceOption[]} {
  // Typing @, $ or ! narrows the picker to that family of values.
  const catalog=flowReferenceChoices(flow,elementId,objects)
    .filter(choice=>!symbol||choice.symbol===symbol);
  const groups=new Map<string,ReferenceGroup>();
  const directOptions:ReferenceOption[]=[];
  for(const choice of catalog){
    const token=referenceName(choice.reference);
    if(!token)continue;
    const parts=token.split('.');
    const compatible=compatibleFlowValue(choice,target,targetObjectApiName);
    const option:ReferenceOption={
      reference:choice.reference,
      label:parts.length>1?choice.label.split(' → ').slice(1).join(' → ')||parts.at(-1)!:choice.label,
      detail:(choice.symbol?choice.symbol+' ':'')+choice.detail,
      dataType:choice.dataType,
      disabled:!compatible||Boolean(choice.unavailableReason),
      reason:choice.unavailableReason||(!compatible
        ?'Incompatible with the destination field type or relationship.':undefined)
    };
    if(parts.length===1){directOptions.push(option);continue;}
    const root=parts[0];
    if(!groups.has(root)){
      const stepName=choice.label.split(' → ')[0];
      groups.set(root,{path:root,label:root,detail:stepName===root
        ?choice.category:stepName+' · '+choice.category,options:[]});
    }
    groups.get(root)!.options.push(option);
  }
  return {groups:[...groups.values()],directOptions};
}
