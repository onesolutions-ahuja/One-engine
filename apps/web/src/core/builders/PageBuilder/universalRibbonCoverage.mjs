/** Verify every registered Smart property is represented exactly once in the shared ribbon.
 * Pure and usable by both CI and the lazy-loaded Page Builder runtime. */
export function auditUniversalRibbonCoverage(manifests,visibleKeys,excludedKeys=[]){
 const excluded=new Set(excludedKeys);
 const expected=new Set();
 const components=new Set();
 for(const component of manifests){
   if(!/^smart_[a-z0-9_]+$/.test(component.apiName))continue;
   components.add(component.apiName);
   for(const property of component.propertyDefinitions??[]){
     if(!excluded.has(property.propertyKey))expected.add(property.propertyKey);
   }
 }
 const visible=[...visibleKeys];
 const actual=new Set(visible);
 return {
   componentCount:components.size,
   declaredPropertyCount:expected.size,
   displayedPropertyCount:actual.size,
   missing:[...expected].filter(key=>!actual.has(key)).sort(),
   duplicates:[...new Set(visible.filter((key,index)=>visible.indexOf(key)!==index))].sort(),
   unexpected:[...actual].filter(key=>!expected.has(key)).sort(),
   explicitlyExcluded:[...excluded].sort()
 };
}
