// Data transferred to isolated component frames is allowlisted, bounded and secret-redacted.
// The host always remains authoritative for RBAC and Flow execution.
const forbiddenKey = /(?:password|secret|credential|authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key|bearer[_-]?token|session[_-]?cookie|session[_-]?secret)/i;
const sensitiveKeys = new Set(['token','clientSecret','passwordHash','passwordSalt','bearerToken','apiKey','secretKey','authHeader']);
export const SAFE_COMPONENT_PROP_KEYS = ['label','title','subtitle','value','device','properties','records',
  'products','categories','cartLines','customers','loading','preview','disabled','sessionId','object','flows','actionError','pageState','viewRevision'] as const;
export function sandboxSafeValue(input: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'string') return input.slice(0,10000);
  if (typeof input !== 'object' || depth > 8 || seen.has(input)) return undefined;
  seen.add(input);
  if (Array.isArray(input)) {
    const result = input.slice(0,500).map((value) => sandboxSafeValue(value,depth+1,seen) ?? null);
    seen.delete(input);
    return result;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const [key,value] of Object.entries(input).slice(0,250)) {
    if (forbiddenKey.test(key) || sensitiveKeys.has(key) || ['__proto__','prototype','constructor'].includes(key)) continue;
    const clean = sandboxSafeValue(value,depth+1,seen);
    if (clean !== undefined) result[key] = clean;
  }
  seen.delete(input);
  return result;
}
/** Only platform-safe props and explicitly configured component metadata properties
 * can cross the sandbox boundary. A tenant cannot opt arbitrary host keys in.
 */
export function sandboxPublicProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const configured = props.properties && typeof props.properties === 'object' &&
    !Array.isArray(props.properties) ? props.properties as Record<string, unknown> : {};
  const names = new Set<string>(SAFE_COMPONENT_PROP_KEYS);
  // Bound both the metadata and the outgoing message. Never pass host callbacks,
  // reserved prototype names, credentials or internal runtime resources through.
  for (const name of Object.keys(configured).slice(0,100)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name) ||
      forbiddenKey.test(name) || sensitiveKeys.has(name) ||
      ['__proto__','prototype','constructor','key','ref','children','onAction','onChange','onNavigate','onLaunchFlow'].includes(name)) continue;
    names.add(name);
  }
  for (const key of names) {
    if (!Object.prototype.hasOwnProperty.call(props,key)) continue;
    if (forbiddenKey.test(key) || sensitiveKeys.has(key)) continue;
    const clean = sandboxSafeValue(props[key]);
    if (clean !== undefined) result[key] = clean;
  }
  return result;
}

/** Reject oversized/untrusted component events before they reach metadata actions or Flow execution. */
export function sandboxSafeAction(input: unknown): {event: string; value?: unknown} | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const action = input as Record<string, unknown>;
  if (typeof action.event !== 'string' || !/^[A-Za-z][A-Za-z0-9_:\-]{0,79}$/.test(action.event)) return null;
  // Stringification bounds total payload size, independently of recursive property limits.
  let bytes = 0;
  try { bytes = JSON.stringify(input)?.length ?? 0; } catch { return null; }
  if (bytes > 32768) return null;
  const value = sandboxSafeValue(action.value);
  return value === undefined ? {event: action.event} : {event: action.event, value};
}
