/** Reuse Flow's existing metadata template resolver; no second expression engine. */
export {template as resolveMessageTemplate} from '../system-files/nodes/ActionNodeShared.js';
export function normalizeMessageRecipients(value:string):string[]{
 return [...new Set(value.split(/[;,\r\n]+/).map(v=>v.trim()).filter(Boolean))];
}
