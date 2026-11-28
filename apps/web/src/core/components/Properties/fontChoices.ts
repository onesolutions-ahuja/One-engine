import type {CSSProperties} from 'react';

/**
 * Font property (Design > Properties): the fonts macOS and Windows use in their own UI. Fonts are
 * never shipped with the app: each choice names the font installed on the device and falls back
 * to the matching font of the other system (SF on a Mac, Segoe on Windows, system-ui elsewhere),
 * so a page looks right on any till, tablet or PC.
 * Saved as properties.fontFamily (the whole component) and properties.partFonts[area] (one text
 * part: Header, Footer, Row...). A part without its own font uses the component's; a component
 * without one uses the page default (System).
 */
export type FontChoice={key:string;label:string;stack:string;from:string};
export const FONT_CHOICES:readonly FontChoice[]=[
 {key:'system',label:'System',from:'SF Pro on Mac, Segoe UI on Windows',
  stack:'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",sans-serif'},
 {key:'sf-pro',label:'SF Pro',from:'macOS',
  stack:'-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",system-ui,sans-serif'},
 {key:'sf-pro-rounded',label:'SF Pro Rounded',from:'macOS',
  stack:'ui-rounded,"SF Pro Rounded","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif'},
 {key:'new-york',label:'New York',from:'macOS',
  stack:'ui-serif,"New York",Georgia,Cambria,"Times New Roman",serif'},
 {key:'sf-mono',label:'SF Mono',from:'macOS',
  stack:'ui-monospace,"SF Mono",Menlo,"Cascadia Mono",Consolas,monospace'},
 {key:'helvetica-neue',label:'Helvetica Neue',from:'macOS',
  stack:'"Helvetica Neue",Helvetica,"Segoe UI",Arial,sans-serif'},
 {key:'segoe-ui',label:'Segoe UI',from:'Windows 10',
  stack:'"Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,sans-serif'},
 {key:'segoe-ui-variable',label:'Segoe UI Variable',from:'Windows 11',
  stack:'"Segoe UI Variable Text","Segoe UI Variable","Segoe UI",-apple-system,system-ui,sans-serif'},
 {key:'cascadia-mono',label:'Cascadia Mono / Consolas',from:'Windows',
  stack:'"Cascadia Mono",Consolas,ui-monospace,"SF Mono",Menlo,monospace'},
];
const byKey=new Map(FONT_CHOICES.map(choice=>[choice.key,choice]));

export const fontStack=(key:unknown):string|undefined=>typeof key==='string'?byKey.get(key)?.stack:undefined;

/** Parts that only show a picture have no text: no font choice there. */
export const isTextArea=(area:string)=>!/(?:^|\s)(?:image|picture|photo|icon|video|qr|chart|map)(?:$|\s)/i.test(area);

/** The component's own font, on its frame: every text part inherits it. */
export function componentFontStyle(properties:Readonly<Record<string,unknown>>|undefined):CSSProperties{
 const stack=fontStack(properties?.fontFamily);
 return stack?{fontFamily:stack,['--md-font-family' as string]:stack} as CSSProperties:{};
}

export function partFonts(properties:Readonly<Record<string,unknown>>|undefined):Record<string,string>{
 const raw=properties?.partFonts;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
 return Object.fromEntries(Object.entries(raw as Record<string,unknown>)
  .filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&byKey.has(entry[1])&&/^[A-Za-z0-9 _-]{1,60}$/.test(entry[0])));
}

/** CSS for the parts with their own font, scoped to one component frame (data-font-scope). */
export function partFontCss(scope:string,properties:Readonly<Record<string,unknown>>|undefined):string{
 const safeScope=scope.replace(/[^A-Za-z0-9_-]/g,'');
 if(!safeScope)return '';
 return Object.entries(partFonts(properties)).map(([area,key])=>
  `[data-font-scope="${safeScope}"] [data-design-area="${area}"],[data-font-scope="${safeScope}"] [data-design-area="${area}"] *{font-family:${byKey.get(key)!.stack}}`)
  .join('\n');
}
