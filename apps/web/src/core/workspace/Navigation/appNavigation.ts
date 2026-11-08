export type AppNavigationEntry = { type: 'Object' | 'App Page'; apiName: string };

/** Preserve explicit metadata order, drop stale/duplicate entries, and append newly selected items. */
export function reconcileNavigationOrder(
  objectApiNames: readonly string[],
  pageApiNames: readonly string[],
  savedOrder: readonly AppNavigationEntry[] = []
): AppNavigationEntry[] {
  const objects = new Set(objectApiNames);
  const pages = new Set(pageApiNames);
  const seen = new Set<string>();
  const ordered: AppNavigationEntry[] = [];
  const append = (entry: AppNavigationEntry) => {
    if (!entry || (entry.type !== 'Object' && entry.type !== 'App Page')) return;
    if (!(entry.type === 'Object' ? objects : pages).has(entry.apiName)) return;
    const key = `${entry.type}:${entry.apiName}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ type: entry.type, apiName: entry.apiName });
  };
  savedOrder.forEach(append);
  objectApiNames.forEach((apiName) => append({ type: 'Object', apiName }));
  pageApiNames.forEach((apiName) => append({ type: 'App Page', apiName }));
  return ordered;
}

/** Reorder safely without mutating the draft, so Cancel/Reset and React updates remain reliable. */
export function moveNavigationEntry(
  entries: readonly AppNavigationEntry[], from: number, to: number
): AppNavigationEntry[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return [...entries];
  const result = [...entries];
  const [entry] = result.splice(from, 1);
  result.splice(to, 0, entry);
  return result;
}
