import {addSharedProperties,addOthersSlots,type Query,type Spec} from './smart-chart.js';

const spec=(key:string,label:string,kind:string,initial:unknown=null,choices:string[]=[]):Spec=>
 [key,label,'Design2','Others',kind,initial===null?null:JSON.stringify(initial),JSON.stringify(choices),null,null];
/** Smart MultiPage (tabbed card; each child is a page). */
export const multiPageProperties:Spec[]=[
 spec('multiPageVisible','Visible tabs','expression'),
 spec('multiPageActive','Active tab','expression'),
 spec('multiPageTabBar','Show tab bar','boolean',true),
 spec('multiPageTabStyle','Tab style','choice','Segmented',['Tabs','Pills','Segmented']),
 spec('multiPageEmptyText','Empty text','expression')
];
/** Tab bar look (macOS segmented by default). Own Others slot range (1911+): slot order numbers
 * are unique per row, so they must never shift the slots the properties above already hold. */
export const multiPageLookProperties:Spec[]=[
 spec('multiPageTabAlign','Tab alignment','choice','Center',['Center','Left','Right','Stretch']),
 spec('multiPageTabSize','Tab size','choice','Medium',['Small','Medium','Large']),
 spec('multiPageTabShape','Tab shape','choice','Rounded',['Rounded','Pill','Square'])
];
/** Every component can be a page of a MultiPage: its key (blank = its name). */
export const pageKeyProperty:Spec=spec('pageKey','Page key','expression');
/** Tab icons: each page's own icon, coloured by the MultiPage (open tab in its own colour).
 * Own slot ranges (1920+, 1930+) so earlier slots never move. */
export const pageIconProperty:Spec=spec('pageIcon','Tab icon','choice','',['icons']);
export const multiPageIconProperties:Spec[]=[
 spec('multiPageIconColor','Tab icon colour','color','#3a3a3c'),
 spec('multiPageSelectedIconColor','Selected tab icon colour','color','#007aff')
];

export async function applySmartMultiPage(client:Query){
 await client.query("INSERT INTO md_builder_ribbon_components(component_api) VALUES('smart_multipage') ON CONFLICT DO NOTHING");
 await client.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
  SELECT t.id,'smart_multipage','smart-bundled:smart_multipage',true FROM md_tenants t
  ON CONFLICT(tenant_id,api_name) DO NOTHING`);
 const all=[...multiPageProperties,pageKeyProperty];
 await addSharedProperties(client,[...all,...multiPageLookProperties,...multiPageIconProperties,pageIconProperty]);
 await addOthersSlots(client,all,1900);
 await addOthersSlots(client,multiPageLookProperties,1910);
 await addOthersSlots(client,multiPageIconProperties,1920);
 await addOthersSlots(client,[pageIconProperty],1930);
 const keys=[...multiPageProperties.map(property=>property[0]),...multiPageLookProperties.map(property=>property[0]),
  ...multiPageIconProperties.map(property=>property[0]),
  'radius','backgroundColor','borderColor','fontFamily','visibleFormula','disabledFormula'];
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT 'smart_multipage',property_key,true FROM md_builder_shared_properties WHERE property_key=ANY($1::text[]) ON CONFLICT DO NOTHING`,[keys]);
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT component_api,p.key,true FROM md_builder_ribbon_components,(VALUES('pageKey'),('pageIcon')) AS p(key)
  ON CONFLICT DO NOTHING`);
 await client.query(`INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT r.component_api,d.area,d.slot_key,d.property_key FROM md_builder_design2_slots d
  JOIN md_builder_ribbon_component_rules r ON r.property_key=d.property_key AND r.enabled
  WHERE d.property_key=ANY($1::text[]) ON CONFLICT DO NOTHING`,[[...keys,'pageKey','pageIcon']]);
}
