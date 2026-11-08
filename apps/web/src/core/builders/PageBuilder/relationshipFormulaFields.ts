import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import {mentionGroups,isCompatibleField,type MentionKind} from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';

export type RelationshipFormulaOption={
 reference:string;label:string;path:string;dataType:string;root:string;
};
/**
 * One metadata-driven field catalogue for every Page Builder formula editor.
 * Only declared parent lookups are traversed (bounded by mentionGroups).
 * Extra selected sources retain their explicit root prefix; selecting an
 * object alone never implies a join between independent record collections.
 */
export function relationshipFormulaFields(
 objects:readonly ObjectMetadata[], sourceObjectApiNames:readonly string[],
 query='', kind:MentionKind='text', directBooleanOnly=false
):RelationshipFormulaOption[]{
 const available=new Set(objects.map(object=>object.apiName));
 const roots=[...new Set(sourceObjectApiNames)].filter(root=>available.has(root));
 const q=query.trim().replace(/^@/,'').toLowerCase();
 const unique=new Map<string,RelationshipFormulaOption>();
 for(let index=0;index<roots.length;index++){
  const root=roots[index];
  for(const group of mentionGroups(objects,root,[],'',kind)){
   for(const field of group.fields){
    if(directBooleanOnly&&(index!==0||!group.primary||
      !/^(checkbox|boolean)$/i.test(field.dataType)))continue;
    if(!isCompatibleField(field.dataType,kind))continue;
    const reference=group.primary&&index===0?'@'+field.fieldApiName:field.reference;
    const path=group.primary?root:group.path;
    const label=path+' → '+field.fieldLabel;
    const option={reference,label,path,dataType:field.dataType,root};
    const lower=reference.slice(1).toLowerCase();
    if(q&&!(lower.includes(q)||!q.includes('.')&&
      (field.fieldLabel.toLowerCase().includes(q)||label.toLowerCase().includes(q))))continue;
    if(!unique.has(reference))unique.set(reference,option);
   }
  }
 }
 return [...unique.values()];
}
