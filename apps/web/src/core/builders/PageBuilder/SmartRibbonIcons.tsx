import {useId} from 'react';

/** Vectored version of the approved two-colour TSize artwork. */
export function RibbonTextSizeIcon(){
 const unique=useId().replaceAll(':','');
 const small=unique+'-small',large=unique+'-large';
 return <svg viewBox="0 0 512 512" width="20" height="20" aria-hidden="true" focusable="false">
  <defs>
   <linearGradient id={large} x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stopColor="#ec2c88"/>
    <stop offset="1" stopColor="#a51d56"/>
   </linearGradient>
   <linearGradient id={small} x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stopColor="#ffe153"/>
    <stop offset="1" stopColor="#ff8c2d"/>
   </linearGradient>
  </defs>
  <path fill={'url(#'+small+')'} d="M0 215H231V316H200V295H155V512H46V295H30V316H0Z"/>
  <path fill={'url(#'+large+')'} d="M110 0H480V158H431V115H369V425H412V512H211V425H254V115H192V158H110Z"/>
 </svg>;
}
/** A rounded corner, not a generic text-size or border glyph. */
export function RibbonCornerRadiusIcon(){
 return <svg viewBox="0 0 24 24" width="19" height="19" fill="none"
  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
  aria-hidden="true" focusable="false">
  <path d="M4 20V10a6 6 0 0 1 6-6h10"/>
  <path d="M10 20v-8a2 2 0 0 1 2-2h8" strokeDasharray="2 3" opacity=".4"/>
 </svg>;
}
