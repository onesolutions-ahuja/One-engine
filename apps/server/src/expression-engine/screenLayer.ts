import type {Expression} from './FormulaParser.js';

/** SCREEN(Page, n): a layer number (0-9) in place of the mode. It opens Page on layer n in
 * this window, or switches Page to layer n where it is already showing (this window, the
 * second screen or a paired screen that follows this device). Null when it is not one. */
export function screenLayerArg(node:Expression|undefined):number|null{
 const value=node?.kind==='literal'?node.value:null;
 const number=typeof value==='number'?value:typeof value==='string'&&/^\d$/.test(value)?Number(value):NaN;
 return Number.isInteger(number)&&number>=0&&number<=9?number:null;
}
