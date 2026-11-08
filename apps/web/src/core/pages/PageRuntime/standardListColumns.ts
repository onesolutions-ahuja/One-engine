/** Saved List View columns apply only when a block has no explicit override.
 * Field names are intersected with the authorised object schema.
 */
export function resolveStandardListColumns(
  configured:readonly string[],saved:readonly string[],
  available:readonly string[],fallback:readonly string[]
):string[]{
 const allowed=new Set(available);
 const chosen=configured.length?configured:saved.length?saved:fallback;
 return [...new Set(chosen.slice(0,12))].filter(field=>allowed.has(field));
}
