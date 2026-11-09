/** What a component publishes when the user picks, types or toggles something.
 *
 * Every component on a page has a name (Navigator name, e.g. CategoryTabs, or the
 * automatic one, e.g. smarttabs1). When it fires change/select/click, the page
 * remembers its current value under that name, and any formula, filter or action
 * reads it as  @CategoryTabs.state.Id / .Value / .Name / .Text / .Field / .Criteria.
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
