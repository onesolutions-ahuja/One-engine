/** What a component publishes when the user picks, types or toggles something.
 *
 * Every component on a page has a name (Navigator name, e.g. CategoryTabs, or the
 * automatic one, e.g. smarttabs1). When it fires change/select/click, the page
 * remembers its current value under that name, and any formula, filter or action
 * reads it as  @ThisPage.CategoryTabs.Selected.Id / .Value / .Name / .Text / .Field / .Criteria.
 * A named COLLECTION() selection uses the same channel under the collection name,
 * so older pages keep working. Generic: nothing here knows any component type. */
export const COMPONENT_STATE_FIELDS=['Id','Name','Value','Text','Field','Criteria'] as const;
export type ComponentStateField=typeof COMPONENT_STATE_FIELDS[number];
export type ComponentState={[K in ComponentStateField]:string|number|boolean|null};

const nameRule=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
/** `Name.state.Field` (no @). Field names are case-insensitive. */
export const componentStateReferencePattern=/^([A-Za-z][A-Za-z0-9_]{0,79})\.state\.(Id|Name|Value|Text|Field|Criteria)$/i;
/** `@Name.state.Field` anywhere inside formula text. */
export const componentStateMentionPattern=/@([A-Za-z][A-Za-z0-9_]{0,79})\.state\.(?:Id|Name|Value|Text|Field|Criteria)\b/gi;

/** A component name usable inside a formula: spaces and hyphens become _. */
export function componentStateName(name:unknown):string|null{
 if(typeof name!=='string')return null;
 const token=name.trim().replace(/[ -]+/g,'_');
 return nameRule.test(token)?token:null;
}
export function parseComponentStateReference(reference:string):{name:string;field:ComponentStateField}|null{
 const match=componentStateReferencePattern.exec(reference);
 if(!match)return null;
 const field=COMPONENT_STATE_FIELDS.find(item=>item.toLowerCase()===match[2].toLowerCase())!;
 return {name:match[1],field};
}
const scalar=(value:unknown):string|number|boolean|null=>
 value===null||value===undefined?null
 :typeof value==='string'||typeof value==='boolean'?value
 :typeof value==='number'?(Number.isFinite(value)?value:null):null;
const text=(value:unknown)=>{const result=scalar(value);return result===null?'':String(result);};

/** Turn any component event payload into the state readers see.
 * Scalars (typed text, toggle, numpad, date) and record selections
 * ({value,label,record}) are both handled. Returns null for payloads that carry
 * no selection (e.g. a plain button click). */
export function componentStateFromEvent(value:unknown):ComponentState|null{
 if(value===undefined)return null;
 const plain=scalar(value);
 if(plain!==null||value===null)
  return {Id:text(value),Name:text(value),Value:plain,Text:text(value),Field:'',Criteria:''};
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const item=value as Record<string,unknown>;
 const record=item.record&&typeof item.record==='object'&&!Array.isArray(item.record)
  ?item.record as Record<string,unknown>:null;
 // A record row passed directly (Card Grid / Table click) is its own record.
 const row=record??(Object.prototype.hasOwnProperty.call(item,'Id')||Object.prototype.hasOwnProperty.call(item,'id')?item:null);
 const own=scalar(item.value);
 const id=text(row?.Id??row?.id??own);
 if(!id&&own===null)return null;
 const name=text(item.label??row?.Name??row?.name??own??id);
 return {Id:id,Name:name,Value:own??id,Text:name,
  Field:text(row?.Field??row?.__collectionCriteriaField),
  Criteria:text(row?.Criteria??row?.__collectionCriteria)};
}

/** Read one value. Unknown names or fields read as blank, never as an error,
 * because nothing is selected until the user acts. */
export function readComponentState(selections:unknown,name:string,field:ComponentStateField):string|number|boolean|null{
 if(!selections||typeof selections!=='object'||Array.isArray(selections))return '';
 const entry=Object.entries(selections as Record<string,unknown>)
  .find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
 if(!entry||typeof entry!=='object'||Array.isArray(entry))return '';
 const record=entry as Record<string,unknown>;
 // Older selections had no Text: it is the same as Name.
 const raw=field==='Text'&&!Object.prototype.hasOwnProperty.call(record,'Text')?record.Name:record[field];
 const result=scalar(raw);
 return result===null&&raw!==null?'':result;
}

/** Component properties formulas and actions may read and set:
 *  @ThisPage.Button1.Disabled, @ThisPage.Button2.Caption = "Pay " & …, @ThisPage.Box.Visible = FALSE.
 * The page holds them under one state key, per component name (lower case):
 *  {set: values an action gave, auto: values the page worked out (Disable when / Show when, caption)}.
 * A value an action set wins; else what the page worked out; else the default. */
export const COMPONENT_PROPERTIES='componentProperties';
export const UI_PROPERTIES=['Caption','Disabled','Visible',
 // Look: @ThisPage.PayBtn.BackgroundColor = "#34C759", .TextColor, .BorderColor, .IconColor, .Icon = "check".
 'BackgroundColor','TextColor','BorderColor','IconColor','Icon'] as const;
export type UiProperty=typeof UI_PROPERTIES[number];
/** Properties whose value is text (the rest are TRUE/FALSE). */
export const TEXT_UI_PROPERTIES:ReadonlySet<UiProperty>=new Set(['Caption','BackgroundColor','TextColor','BorderColor','IconColor','Icon']);
const COLOR_PROPERTIES:ReadonlySet<UiProperty>=new Set(['BackgroundColor','TextColor','BorderColor','IconColor']);
/** A colour a formula may set: #RGB/#RRGGBB(AA), rgb()/rgba()/hsl(), a CSS colour name, or blank (back to the design). */
const COLOR_VALUE=/^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([0-9.,%\s/]+\)|[a-z]{3,20})$/i;
/** Component properties the look values above are drawn with (Icon: a button's icon, else an icon component's). */
export function uiPropertyProps(held:Partial<Record<UiProperty,unknown>>,componentApi:string):Record<string,unknown>{
 const out:Record<string,unknown>={};
 const text=(value:unknown)=>value===null||value===undefined?'':String(value);
 if(held.BackgroundColor!==undefined&&text(held.BackgroundColor)){
  out.backgroundColor=text(held.BackgroundColor);out.shapeFill=text(held.BackgroundColor);}
 if(held.TextColor!==undefined&&text(held.TextColor))out.labelColor=text(held.TextColor);
 if(held.BorderColor!==undefined&&text(held.BorderColor))out.borderColor=text(held.BorderColor);
 if(held.IconColor!==undefined&&text(held.IconColor))out.iconFillColor=text(held.IconColor);
 if(held.Icon!==undefined&&text(held.Icon)){
  if(componentApi==='smart_button')out.shapeId=text(held.Icon);else out.iconId=text(held.Icon);
 }
 return out;
}
export const uiProperty=(name:unknown):UiProperty|null=>typeof name==='string'
 ?UI_PROPERTIES.find(item=>item.toLowerCase()===name.toLowerCase())??null:null;
type Held={set?:Record<string,unknown>;auto?:Record<string,unknown>};
const heldFor=(state:unknown,name:string):Held=>{
 const all=state&&typeof state==='object'&&!Array.isArray(state)
  ?(state as Record<string,unknown>)[COMPONENT_PROPERTIES]:undefined;
 const entry=all&&typeof all==='object'&&!Array.isArray(all)?(all as Record<string,unknown>)[name.toLowerCase()]:undefined;
 return entry&&typeof entry==='object'&&!Array.isArray(entry)?entry as Held:{};
};
/** A property an action set on this component (undefined when none). */
export function setComponentProperty(state:unknown,name:string,property:UiProperty):unknown{
 const set=heldFor(state,name).set;
 return set&&Object.prototype.hasOwnProperty.call(set,property)?set[property]:undefined;
}
/** What @ThisPage.Name.Disabled / Caption / Visible reads now. */
export function readComponentProperty(state:unknown,name:string,property:UiProperty):string|boolean{
 const held=heldFor(state,name);
 const pick=(from:Record<string,unknown>|undefined)=>from&&Object.prototype.hasOwnProperty.call(from,property)?from[property]:undefined;
 const value=pick(held.set)??pick(held.auto);
 if(TEXT_UI_PROPERTIES.has(property))return value===undefined||value===null?'':String(value);
 if(value===undefined||value===null)return property==='Visible';
 return value===true||value===1||String(value).toUpperCase()==='TRUE';
}
/** Check a value given with `@ThisPage.Name.Disabled = …` before it is held. */
export function uiPropertyValue(property:UiProperty,value:unknown):string|boolean{
 if(COLOR_PROPERTIES.has(property)){
  const colour=value===null||value===undefined?'':String(value).trim();
  if(colour&&!COLOR_VALUE.test(colour))throw Error(property+' must be a colour such as "#34C759" or "green"');
  return colour;
 }
 if(property==='Icon'){
  const icon=value===null||value===undefined?'':String(value).trim();
  if(icon&&!/^[a-z0-9][a-z0-9:-]{0,63}$/i.test(icon))throw Error('Icon must be an icon name such as "check"');
  return icon;
 }
 if(property==='Caption'){
  if(value!==null&&value!==undefined&&!['string','number','boolean'].includes(typeof value))
   throw Error('A caption must be text');
  return value===null||value===undefined?'':String(value);
 }
 if(typeof value==='boolean')return value;
 if(typeof value==='number')return value!==0;
 if(typeof value==='string'&&/^(true|false)$/i.test(value.trim()))return value.trim().toUpperCase()==='TRUE';
 throw Error(property+' must be TRUE or FALSE');
}
/** State with one component's held properties changed (a new object only when something changed). */
export function withComponentProperties(state:Readonly<Record<string,unknown>>,name:string,
 part:'set'|'auto',values:Readonly<Record<string,unknown>>):Readonly<Record<string,unknown>>{
 const key=name.toLowerCase();
 const held=heldFor(state,key);
 const current=held[part]??{};
 if(Object.entries(values).every(([prop,value])=>Object.is(current[prop],value)))return state;
 const all={...(state[COMPONENT_PROPERTIES] as Record<string,unknown>|undefined)};
 all[key]={...held,[part]:{...current,...values}};
 return {...state,[COMPONENT_PROPERTIES]:all};
}
