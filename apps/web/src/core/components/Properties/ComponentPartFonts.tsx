import {partFontCss} from './fontChoices';

/** Fonts chosen for single parts (Header, Footer...) of one component: a tiny scoped style.
 * Nothing is rendered when no part has its own font. */
export default function ComponentPartFonts({scope,properties}:{scope:string;properties:Readonly<Record<string,unknown>>|undefined}){
 const css=partFontCss(scope,properties);
 return css?<style data-part-fonts={scope}>{css}</style>:null;
}
