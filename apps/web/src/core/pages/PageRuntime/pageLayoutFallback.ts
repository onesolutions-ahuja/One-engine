// A narrow window asks for the Mobile layout. A page built for Desktop only has none:
// the page opens at once on the best layout it does have (nearest wider first), never a
// blank page or "Page not found". The server answers this in the same request; this is
// the browser's own guard for any answer that still says "not found".
export function pageLayoutFallbacks(layout: string): string[] {
  if (layout === 'Mobile' || layout === 'Phone') return ['Tablet', 'Desktop'];
  if (layout === 'Tablet' || layout === 'Custom') return ['Desktop'];
  return [];
}
function isNotFound(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || (error instanceof Error && /not found/i.test(error.message));
}
/** Asks for the page on `layout`; when that layout does not exist ("not found") asks at
 * once for the next layout. Any other answer or failure is returned as it is. */
export async function requestPageWithLayoutFallback<T>(request: (layout: string) => Promise<T>, layout: string): Promise<T> {
  let failure: unknown;
  for (const candidate of [layout, ...pageLayoutFallbacks(layout)]) {
    try { return await request(candidate); }
    catch (error) {
      if (!isNotFound(error)) throw error;
      failure ??= error;
    }
  }
  throw failure;
}
