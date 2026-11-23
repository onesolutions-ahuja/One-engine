import type {Query} from './smart-chart.js';

/** New Smart Numpads start with the till lock-pad look: round keys, big digits,
 * soft fill, no border. Defaults apply to new inserts only; every value stays a
 * normal property. Keyboard and Dock (which share these keys) are untouched. */
const ROUND_DEFAULTS:Array<[string,string]>=[
 ['numpadKeyShape',JSON.stringify('shape:oval')],['numpadKeyHeight','64'],
 ['numpadKeyFill',JSON.stringify('#eef1f5')],['numpadKeyBorderColor',JSON.stringify('#eef1f5')],
 ['numpadKeyTextSize','28'],['gap','12']
];
export async function applySmartNumpadRound(client:Query){
 for(const [key,value] of ROUND_DEFAULTS)await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT 'smart_numpad',$1,true,$2::jsonb FROM md_builder_shared_properties WHERE property_key=$1
  ON CONFLICT(component_api,property_key) DO UPDATE SET default_value_override=EXCLUDED.default_value_override`,[key,value]);
}
