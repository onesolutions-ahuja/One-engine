// Presentation-only model for components already present on a Page Builder layout.
// It never expands record-driven grids into individual records or changes runtime labels.
const text = value => typeof value === 'string' ? value.trim() : '';
const readable = value => text(value).replace(/\s+/g, ' ').slice(0, 110);
const displayKeys = ['caption','buttonText','text','placeholder','title','heading','displayText','badgeText','textValue','label','value','defaultValue'];
const bindingKeys = /(?:field|formula|expression|binding|textsource|valuesource)/i;
export function navigatorParentId(component) {
  return text(component.properties?.layoutParentId) || text(component.parentId) || null;
}
export function navigatorType(type, labels = {}) {
  if (!type.startsWith('Custom:')) return type;
  const api = type.slice(7);
  return labels[api] || api.replace(/^(?:smart|ui|une)_/i, '').split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
function componentDisplay(component, type) {
  const props = component.properties || {};
  const override = readable(props.navigatorName);
  if (override) return override;
  for (const key of displayKeys) {
    const value = readable(props[key]);
    if (value && value !== component.type && value.toLowerCase() !== type.toLowerCase()
      && !/[@{}]/.test(value)) return value;
  }
  const label = readable(component.label);
  return label || type;
}
export function buildPageNavigatorEntries(components, typeLabels = {}) {
  const byId = new Map(components.map(item => [item.id,item]));
  const children = new Map();
  for (const item of components) {
    const parentId = navigatorParentId(item);
    const key = parentId && byId.has(parentId) && parentId !== item.id ? parentId : '';
    children.set(key, [...(children.get(key) || []), item]);
  }
  const visited = new Set();
  const draft = [];
  function visit(item, parentPath = [], depth = 0) {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const type = navigatorType(item.type, typeLabels);
    const baseName = componentDisplay(item,type);
    const region = item.region === 'header' ? 'Header' : item.region === 'sidebar' ? 'Sidebar' : item.region === 'main' ? 'Main' : 'Canvas';
    const pathParts = parentPath.length ? parentPath : [region];
    const path = pathParts.join(' / ');
    const props = item.properties || {};
    const bindings = Object.entries(props).filter(([key,value]) => (bindingKeys.test(key) || (displayKeys.includes(key) && typeof value === 'string' && /[@{}]/.test(value))) && typeof value === 'string' && text(value))
      .slice(0, 6).map(([key,value]) => key + ': ' + readable(value));
    const location = item.position ? 'x:' + Math.round(item.position.x) + ' y:' + Math.round(item.position.y) : '';
    draft.push({
      id:item.id, type, baseName, name:baseName, path, depth:Math.min(depth,8),
      hidden:item.visible === false, locked:props.editorLocked === true,
      customName:Boolean(text(props.navigatorName)), location,
      detail:bindings[0] || '', searchText:'',
      searchable:[...displayKeys.map(key=>readable(props[key])).filter(Boolean), ...bindings].join(' ')
    });
    for (const child of children.get(item.id) || []) visit(child,[...pathParts,baseName],depth+1);
  }
  for (const item of children.get('') || []) visit(item);
  for (const item of components) visit(item); // Orphans/cycles remain discoverable.
  const counts = new Map();
  const seen = new Map();
  for (const row of draft) {
    const key = row.type + '\u0000' + row.baseName;
    counts.set(key,(counts.get(key)||0)+1);
  }
  return draft.map(row=>{
    const key = row.type + '\u0000' + row.baseName;
    const number = (seen.get(key)||0)+1;
    seen.set(key,number);
    const name = counts.get(key)>1 ? row.baseName + ' · ' + number : row.baseName;
    return {...row,name,searchText:[row.type,row.baseName,name,row.path,row.id,row.location,row.detail,row.searchable].join(' ').toLocaleLowerCase()};
  });
}
export function filterPageNavigatorEntries(entries, query = '', type = '') {
  const terms = text(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(item=>(!type || item.type === type) &&
    terms.every(term=>item.searchText.includes(term)));
}
