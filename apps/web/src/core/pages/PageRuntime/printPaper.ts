/** Paper for printed Print Templates: always the designed size, never scaled to fit. */
/** Templates up to this designed width (CSS px, about 106 mm) are receipts on roll paper. */
export const ROLL_MAX_WIDTH=400;
export type PrintPageSize={width:number;height:number;roll:boolean};
/** Paper size for a rendered template. A roll is one continuous page as long as the receipt;
 * a sheet (A4 and similar) keeps its designed page height and longer content runs onto more pages. */
export function printPageSize(width:number,fittedHeight:number,designedHeight:number):PrintPageSize{
 const w=Math.max(1,Math.round(width));
 const roll=w<=ROLL_MAX_WIDTH;
 const height=roll?Math.max(1,Math.ceil(fittedHeight)):Math.max(1,Math.round(designedHeight||fittedHeight));
 return {width:w,height,roll};
}
/** The print stylesheet for the browser print window: the designed size, no margins (which also
 * removes the browser's date/URL header and footer), colours kept, nothing scaled. */
export function printPageCss(size:Pick<PrintPageSize,'width'|'height'>):string{
 return `@page{size:${size.width}px ${size.height}px;margin:0}
html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:${size.width}px}
*{scrollbar-width:none}*::-webkit-scrollbar{display:none}
.md-print-frame-page{position:relative;width:${size.width}px;overflow:visible}
.md-print-frame-page>.free-canvas-runtime{position:relative!important;left:0!important;top:0!important;
 margin:0!important;transform:none!important}`;
}
