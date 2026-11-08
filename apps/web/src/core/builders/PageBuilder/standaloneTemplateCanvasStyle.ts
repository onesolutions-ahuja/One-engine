/** Size a standalone template's preview without clipping portrait canvases.
 * Shared pure helper keeps the large Page Builder editor focused on wiring.
 */
export function standaloneTemplateCanvasStyle(canvasWidth: number, canvasHeight: number) {
  const designHeight = canvasHeight > canvasWidth
    ? Math.max(640, canvasHeight)
    : Math.max(480, Math.min(canvasHeight, 1080));
  return { minHeight: designHeight, height: designHeight, overflow: 'visible' as const };
}
