import {addSharedProperties,addOthersSlots,type Query,type Spec} from './smart-chart.js';

const spec=(key:string,label:string,kind:string,initial:unknown=null,choices:string[]=[]):Spec=>
 [key,label,'Design2','Others',kind,initial===null?null:JSON.stringify(initial),JSON.stringify(choices),null,null];
export const mapProperties:Spec[]=[
 ...Object.entries({x:'X position',y:'Y position',width:'Width',height:'Height',shape:'Shape field',rotation:'Rotation',label:'Label',subLabel:'Secondary label'}).map(([name,label])=>spec(name+'Field',label,'expression')),
 ...Object.entries({colourFormula:'Colour formula',borderFormula:'Border formula',badgeFormula:'Badge formula',pulseWhen:'Pulse when'}).map(([key,label])=>spec(key,label,'expression')),
 spec('mapShape','Shape','choice','Rectangle',['Square','Rectangle','Round','Oval','Bench','Icon']),
 spec('mapMode','Mode','choice','Use',['Use','Edit']),spec('gridSize','Grid size','number',10),
 spec('mapBackground','Background','choice','Plain',['Plain','Grid','Image']),spec('mapBackgroundAsset','Background asset','expression'),
 spec('zoomToFit','Zoom to fit','boolean',false)
];
export async function applySpaceMap(client:Query){
 await client.query("INSERT INTO md_builder_ribbon_components(component_api) VALUES('smart_spacemap') ON CONFLICT DO NOTHING");
 await addSharedProperties(client,mapProperties);
 const labels=mapProperties.slice(0,12).map(([key,label])=>[
  key,key.endsWith('Field')?key.slice(0,-5)+' field':key.replace(/([A-Z])/g,' $1'),label
 ]);
 await client.query(`UPDATE md_builder_shared_properties p SET label=l.new_label
  FROM unnest($1::text[],$2::text[],$3::text[]) l(key,old_label,new_label)
  WHERE p.property_key=l.key AND p.label=l.old_label`,[0,1,2].map(i=>labels.map(row=>row[i])));
 await addOthersSlots(client,mapProperties,1700);
 const keys=[...mapProperties.map(property=>property[0]),'objectApiName','collectionFormula','filterFormula','sortField','sortDirection',
  'fontFamily','radius','shadow','labelColor','backgroundColor','textSize','iconId','visibleFormula','disabledFormula'];
 await client.query(`INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
  SELECT 'smart_spacemap',property_key,true FROM md_builder_shared_properties WHERE property_key=ANY($1::text[]) ON CONFLICT DO NOTHING`,[keys]);
 await client.query(`INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
  SELECT 'smart_spacemap',area,slot_key,property_key FROM md_builder_design2_slots
  WHERE property_key=ANY($1::text[]) ON CONFLICT DO NOTHING`,[keys]);
}
