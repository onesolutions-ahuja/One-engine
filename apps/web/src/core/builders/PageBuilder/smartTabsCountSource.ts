/** A Tabs count is manually editable only when tabs are not data-backed.
 * Keep this detection aligned with SmartRuntime's Object/Collection sources,
 * rather than inferring it from a selected Design panel section.
 */
export function smartTabsHaveDataSource(properties:Record<string,unknown>):boolean{
 const filled=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
 const collection=properties.dataCollection;
 const collectionConnected=filled(collection)||
   (collection!==null&&typeof collection==='object'&&(
     filled((collection as {name?:unknown}).name)||
     Array.isArray((collection as {items?:unknown}).items)
   ));
 return filled(properties.objectApiName)||
   filled(properties.collectionFormula)||
   filled(properties.dataSource)||
   collectionConnected;
}
