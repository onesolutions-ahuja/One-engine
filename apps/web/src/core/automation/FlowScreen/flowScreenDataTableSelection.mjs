/** Never treat stale/missing record IDs as selected Data Table values. */
export function validFlowScreenSelection(value, collection, multiple) {
  const ids = new Set(collection.filter(record => record && typeof record.Id === 'string' && record.Id).map(record => record.Id));
  const proposed = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const result = [...new Set(proposed.filter(id => typeof id === 'string' && ids.has(id)))];
  return multiple ? result : result.slice(0, 1);
}
