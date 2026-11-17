/**
 * A page's start action and its page state across runtime rebuilds.
 *
 * Live and Preview first draw the page before its page code has loaded, then
 * build the runtime again when the code arrives (and again on a metadata
 * reload). Two things must survive that:
 *  - a Formula start action (e.g. =STATE(sk, @ThisPage.Session.Id)) runs as
 *    page code, so it waits for the code instead of failing once and never
 *    running again;
 *  - the page state of the same page session (sk, picked tabs...) is kept,
 *    so lists filtered by it do not lose their value.
 */
type State=Record<string,unknown>;

/** The page session this start action is for, or '' while it must wait. */
export function pageStartKey(sessionId:string,start:unknown,pageCodeReady:boolean):string{
 if(!sessionId||!start||typeof start!=='object'||Array.isArray(start))return '';
 if((start as {actionType?:unknown}).actionType==='Formula'&&!pageCodeReady)return '';
 return sessionId;
}

export type CarriedPageState={session:()=>string;state:()=>State};

/** State for a rebuilt runtime: the previous runtime's state when it is the same page
 * session, then the host's own initial values (a screen's inputs) on top. */
export function carriedPageState(previous:CarriedPageState|null,session:string,initial?:State):State{
 const kept=previous&&previous.session()===session?previous.state():undefined;
 return {...(kept??{}),...(initial??{})};
}
