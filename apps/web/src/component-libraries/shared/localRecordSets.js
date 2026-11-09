// Registry for the page runtime's shared record-set store. The component
// library stays independent of the app shell: the shell registers a provider,
// and formula evaluation asks it for complete rows. No provider = server path.
let provider=null;

/** provider.rowsFor(object, filters) -> Promise<rows[]|null> (complete, RBAC-filtered rows). */
export function setLocalRecordSetProvider(next){provider=next??null;}
export function getLocalRecordSetProvider(){return provider;}
