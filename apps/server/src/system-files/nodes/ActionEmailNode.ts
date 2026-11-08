import type {ActionContext} from './ActionNodeShared.js';

export async function executeActionEmailNode(_context:ActionContext):Promise<void>{
 throw new Error('SMTP-based Flow email actions are disabled; configure delivery with an HTTPS Named Credential and HTTP Callout');
}
