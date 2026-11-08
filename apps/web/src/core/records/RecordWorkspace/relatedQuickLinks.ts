/** Related-list shortcuts are presentation only. Never expose a configured
 * relationship that is absent from the authorised related-record response.
 */
export function visibleRelatedListQuickLinks(
  configured:readonly string[],
  related:Readonly<Record<string,{objectApiName:string}>>,
  objects:ReadonlyArray<{apiName:string;pluralLabel:string}>
):string[]{
  return [...new Set(configured.filter(name=>typeof name==='string'&&name.length>0))]
    .filter(name=>Object.entries(related).some(([key,value])=>{
      const child=objects.find(item=>item.apiName===value.objectApiName);
      return key.toLowerCase()===name.toLowerCase()
        ||child?.pluralLabel.toLowerCase()===name.toLowerCase();
    }));
}
