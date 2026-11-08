import type {Design2Slot,Design2SlotRule} from './builderPropertyInventory';

// These are retired from the ribbon presentation, not from metadata or saved pages.
export const HIDDEN_RIBBON_PROPERTY_KEYS=new Set(['imageBorderColor','iconFillColor','defaultCheck','columnVisibility','badgeVisible','tabIndex']);

/** A Layout control may disappear only if every selected component can edit that
 * exact property through an enabled Design 2 control. Different keys (for example,
 * tabWidth vs width, or imageBorderColor vs borderColor) are not interchangeable.
 */
export const hasDesign2LayoutEquivalent=(
  propertyKey:string,
  selectedApis:readonly string[],
  supportedApis:readonly string[],
  slots:readonly Design2Slot[],
  rules:readonly Design2SlotRule[]
):boolean=>{
  if(!selectedApis.length||!selectedApis.every(api=>supportedApis.includes(api)))return false;

  // Design 2's position row is created directly, without SQL slot rules.
  if(propertyKey==='x'||propertyKey==='y')return true;
  // The Badge context selector renders a separate visibility button.
  if(propertyKey==='badgeVisible')return slots.some(slot=>slot.area==='Badge');

  // SmartRibbon renders the fixed Body scaffold plus two Image controls.
  // A SQL rule with no actual area slot (or no matching scaffold key) is not
  // a reachable Design control and must not hide the Layout alternative.
  const scaffoldKeys=new Set(slots.filter(slot=>slot.area==='Body'||
    (slot.area==='Image'&&['placement','imageFill'].includes(slot.slotKey)))
    .map(slot=>slot.slotKey));
  return selectedApis.every(api=>rules.some(rule=>
    rule.componentApi===api&&rule.propertyKey===propertyKey&&
    scaffoldKeys.has(rule.slotKey)&&
    slots.some(slot=>slot.area===rule.area&&slot.slotKey===rule.slotKey)));
};
