import {addSharedProperties,addOthersSlots,type Query,type Spec} from './smart-chart.js';

const spec=(key:string,label:string,kind:string,initial:unknown=null,choices:string[]=[]):Spec=>
 [key,label,'Design2','Others',kind,initial===null?null:JSON.stringify(initial),JSON.stringify(choices),null,null];
export const mapProperties:Spec[]=[
 ...['x','y','width','height','shape','rotation','label','subLabel'].map(name=>spec(name+'Field',name+' field','expression')),
 ...['colourFormula','borderFormula','badgeFormula','pulseWhen'].map(key=>spec(key,key.replace(/([A-Z])/g,' $1'),'expression')),
 spec('mapShape','Shape','choice','Rectangle',['Square','Rectangle','Round','Oval','Bench','Icon']),
 spec('mapMode','Mode','choice','Use',['Use','Edit']),spec('gridSize','Grid size','number',10),
 spec('mapBackground','Background','choice','Plain',['Plain','Grid','Image']),spec('mapBackgroundAsset','Background asset','expression'),
 spec('zoomToFit','Zoom to fit','boolean',false)
];
export async function applySpaceMap(client:Query){
 await client.query("INSERT INTO md_builder_ribbon_components(component_api) VALUES('smart_spacemap') ON CONFLICT DO NOTHING");
 await addSharedProperties(client,mapProperties);
 await addOthersSlots(client,mapProperties,1700);
 const keys=[...mapProperties.map(property=>property[0]),'objectApiName','collectionFormula','filterFormula','sortField','sortDirection',
  'fontFamily','radius','shadow','labelColor','backgroundColor','textSize','iconId','visibleFormula','disabledFormula'];
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT 'smart_spacemap',property_key,true FROM md_builder_shared_properties WHERE property_key=ANY($1::text[]) ON CONFLICT DO NOTHING`,[keys]);
 await client.query(`INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT 'smart_spacemap',area,slot_key,property_key FROM md_builder_design2_slots
  WHERE property_key=ANY($1::text[]) ON CONFLICT DO NOTHING`,[keys]);
}
