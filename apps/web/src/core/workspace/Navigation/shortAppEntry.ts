/** Pure short app entry resolver used by the shared router and Node tests.
 * This only resolves an app name; tenant licence and RBAC are server-enforced.
 */
export function shortAppEntry(pathname: string): string | null {
  const segments=pathname.split('/').filter(Boolean);
  if(segments.length!==1)return null;
  const slug=segments[0];
  if(!/^[a-z][a-z0-9]*$/.test(slug) ||
    ['login','logout','oauth','api','une','index'].includes(slug))return null;
  return slug[0].toUpperCase()+slug.slice(1);
}
