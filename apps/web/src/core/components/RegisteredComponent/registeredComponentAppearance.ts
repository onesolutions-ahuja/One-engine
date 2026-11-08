import type { CSSProperties } from 'react';

/** Shared, allowlisted appearance tokens for any registered component.
 * No customer-provided CSS strings, JS or unsafe URL values enter the runtime.
 * Unset keys preserve the existing component defaults and published pages.
 */
type AppearanceStyle = CSSProperties & Record<`--md-${string}`, string | number>;
const numeric = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const color = (value: unknown): string | undefined =>
  typeof value === 'string' && /^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?|transparent)$/i.test(value)
    ? value : undefined;
const length = (value: unknown): string | undefined =>
  typeof value === 'string' && /^(?:auto|0|[0-9]{1,4}(?:\.[0-9]{1,2})?(?:px|%|rem|vh|vw))$/.test(value)
    ? value : undefined;
const option = <T extends string>(value: unknown, choices: readonly T[]): T | undefined =>
  typeof value === 'string' && choices.includes(value as T) ? value as T : undefined;
const shadows: Record<string,string> = {
  none:'none',small:'0 1px 3px rgba(15,23,42,.12)',
  medium:'0 4px 12px rgba(15,23,42,.14)',
  large:'0 10px 24px rgba(15,23,42,.17)'
};
const fontFamilies: Record<string,string> = {
  system:'system-ui, sans-serif',sans:'Arial, Helvetica, sans-serif',
  serif:'Georgia, serif',mono:'ui-monospace, monospace'
};
const appearanceKeys = [
  'fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','margin',
  'minWidth','minHeight','maxWidth','maxHeight','borderWidth','cardDensity','cardPadding',
  'cardRadius','cardMinHeight','cardBackgroundColor','cardBorderColor','cardBorderWidth',
  'cardShadow','cardHover','imageHeight','imageFit','imageAspectRatio'
];
export const hasCustomComponentAppearance = (props: Record<string, unknown>) =>
  appearanceKeys.some(key => props[key] !== undefined);
export function registeredComponentAppearance(props: Record<string, unknown>): AppearanceStyle {
  const style: AppearanceStyle = {};
  const put = (key: `--md-${string}`, value: string | number | undefined) => {
    if (value !== undefined) style[key] = value;
  };
  const family = option(props.fontFamily,Object.keys(fontFamilies));
  if (family) style.fontFamily=fontFamilies[family];
  const size=numeric(props.fontSize,8,96);
  if(size!==undefined) style.fontSize=size;
  const weight=option(props.fontWeight,['400','500','600','700','800']);
  if(weight) style.fontWeight=Number(weight);
  const line=numeric(props.lineHeight,1,3);
  if(line!==undefined)style.lineHeight=line;
  const tracking=numeric(props.letterSpacing,-2,20);
  if(tracking!==undefined)style.letterSpacing=tracking;
  const alignment=option(props.textAlign,['left','center','right','start','end']);
  if(alignment)style.textAlign=alignment;
  const margin=numeric(props.margin,0,160);
  if(margin!==undefined)style.margin=margin;
  for(const key of ['minWidth','maxWidth','minHeight','maxHeight'] as const){
    const value=length(props[key]);
    if(value!==undefined)style[key]=value;
  }
  const border=numeric(props.borderWidth,0,24);
  if(border!==undefined){
    // The metadata host is invisible geometry; paint only the nested native control.
    put('--md-border-width',border+'px');
  }
  const density=option(props.cardDensity,['default','compact','comfortable','image-focused']);
  if(density==='compact'){
    put('--md-card-padding','6px');put('--md-card-height','0px');
  }else if(density==='comfortable'){
    put('--md-card-padding','18px');
  }else if(density==='image-focused'){
    put('--md-card-padding','8px');put('--md-image-height','180px');
  }
  const cardPadding=numeric(props.cardPadding,0,128);
  if(cardPadding!==undefined)put('--md-card-padding',cardPadding+'px');
  const cardRadius=numeric(props.cardRadius,0,128);
  if(cardRadius!==undefined)put('--md-card-radius',cardRadius+'px');
  const cardHeight=numeric(props.cardMinHeight,0,1000);
  if(cardHeight!==undefined)put('--md-card-height',cardHeight+'px');
  put('--md-card-background',color(props.cardBackgroundColor));
  put('--md-card-border',color(props.cardBorderColor));
  const cardBorder=numeric(props.cardBorderWidth,0,16);
  if(cardBorder!==undefined)put('--md-card-border-width',cardBorder+'px');
  const shadow=option(props.cardShadow,Object.keys(shadows));
  if(shadow)put('--md-card-shadow',shadows[shadow]);
  const hover=option(props.cardHover,['none','lift','highlight']);
  if(hover==='lift')put('--md-card-hover-transform','translateY(-3px)');
  if(hover==='none')put('--md-card-hover-transform','none');
  if(hover==='highlight')put('--md-card-hover-shadow',shadows.medium);
  const imageHeight=numeric(props.imageHeight,0,900);
  if(imageHeight!==undefined)put('--md-image-height',imageHeight+'px');
  const fit=option(props.imageFit,['contain','cover','fill','scale-down']);
  if(fit)put('--md-image-fit',fit);
  const ratio=option(props.imageAspectRatio,['auto','1/1','4/3','16/9','3/4']);
  if(ratio)put('--md-image-ratio',ratio);
  return style;
}
export function registeredComponentAppearanceClasses(props: Record<string,unknown>): string {
  return [
    hasCustomComponentAppearance(props)?'md-component-appearance':'',
    props.hideOnTablet===true?'md-hide-tablet':'',
    props.hideOnDesktop===true?'md-hide-desktop':''
  ].filter(Boolean).join(' ');
}
