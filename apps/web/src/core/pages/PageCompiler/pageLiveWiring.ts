import type {CompiledDataSource} from './compilePage';
import type {CompiledDataLayer} from './compiledPageStore';
import {noteOwnWrites,subscribeLiveChanges,type LiveChange,type LiveEvent,type LiveTap,type LiveTapChange} from './liveChanges';
import {noteLiveDrawn,timingNow} from './pageTimings';

/**
 * Live changes for one open page (any app: till, kiosk, display, back office).
 * Records saved anywhere (another till, the till a display follows, a Flow, another user)
 * arrive on the shared stream; this page then
 * - patches its lists in place when the saved rows came with the change and the list can
 *   take them exactly (data.saved with `live`), else re-reads those lists fresh;
 * - updates the held record sets (instant taps, totals over held rows) from the same rows;
 * - re-reads the server totals (display formulas over rows not held) over those Objects.
 * Changes to one Object within MERGE_MS are merged, so a line and its cart are one step.
 */
export const LIVE_MERGE_MS=30;
type Row=Record<string,unknown>;
type CodeTarget={
 applyLiveRows(object:string,rows:ReadonlyArray<Row>,gone?:readonly string[]):void;
 liveChanged(objects:readonly string[],withoutRows?:readonly string[]):Promise<void>;
 loadSets():Promise<void>;
 refreshTotals():Promise<void>|void;
};
export type PageLiveTarget={
 apiName:string;pageSessionKey:string;
 dataSources:readonly CompiledDataSource[];
 data:Pick<CompiledDataLayer,'saved'|'live'|'reload'>;
 code?:CodeTarget|null;
};

/** Live changes of one Object waiting to be drawn. `rows` null: something came without
 * its rows (a bulk save): the lists re-read instead of patching. */
type Pending={object:string;ids:Set<string>;count:number;operation:string;rows:Map<string,Row>|null;created:Set<string>};

const exactDelete=(change:LiveChange)=>change.operation==='delete'&&change.ids.length>0&&change.count<=change.ids.length;

/** Fold one more change of the same Object into what is waiting. A delete (Ids only) folds
 * into saved rows exactly: an Id in `ids` without a row is drawn as gone. */
export function mergeLiveChange(before:Pending|undefined,change:LiveChange):Pending{
 const pending:Pending=before??{object:change.object,ids:new Set(),count:0,operation:change.operation,
  rows:change.rows||exactDelete(change)?new Map():null,created:new Set()};
 if(before&&before.operation!==change.operation)pending.operation='mixed';
 pending.count+=change.count;
 for(const id of change.ids)pending.ids.add(id);
 if(change.count>change.ids.length)pending.rows=null;
 else if(change.rows){
  const seen=new Set<string>();
  for(const row of change.rows){
   const id=String(row.Id??'');
   if(!id)continue;
   seen.add(id);
   pending.rows?.set(id,row);
   if(change.operation==='insert')pending.created.add(id);
  }
  // Named but not in the rows: deleted, or no longer visible to this user.
  for(const id of change.ids)if(!seen.has(id))pending.rows?.delete(id);
 }else if(exactDelete(change)){for(const id of change.ids){pending.rows?.delete(id);pending.created.delete(id);}}
 else pending.rows=null;
 return pending;
}

/** Draw merged changes on the page. Returns the work (for tests and timings). */
export function drawLiveChanges(target:PageLiveTarget,changes:readonly Pending[]):Promise<unknown>{
 const work:Promise<unknown>[]=[];
 for(const change of changes){
  const ids=[...change.ids];
  if(change.rows){
   const rows=[...change.rows.values()];
   const gone=ids.filter(id=>!change.rows!.has(id));
   // The rows came with the change: patch what is on screen, no second request.
   const recordChanges=[...rows.map(record=>({objectApiName:change.object,
    operation:(change.created.has(String(record.Id))?'create':'update') as 'create'|'update',record})),
    ...gone.map(id=>({objectApiName:change.object,operation:'delete' as const,record:{Id:id}}))];
   work.push(target.data.saved({pageSessionKey:target.pageSessionKey,objectApiNames:[change.object],recordChanges,live:true}).catch(()=>undefined));
   target.code?.applyLiveRows(change.object,rows,gone);
  }else work.push(target.data.live({object:change.object,ids,count:change.count,
   operation:change.operation==='mixed'?'update':change.operation}).catch(()=>undefined));
 }
 if(target.code)work.push(target.code.liveChanged(changes.map(change=>change.object),
  changes.filter(change=>!change.rows).map(change=>change.object)).catch(()=>undefined));
 return Promise.all(work);
}

/** Taps of this login's other screens: the provisional (predicted) new rows of each tap
 * still waiting for its answer, per Object, and the taps already answered. */
export type TapLedger={waiting:Map<string,Map<string,Set<string>>>;answered:Set<string>};
export const newTapLedger=():TapLedger=>({waiting:new Map(),answered:new Set()});
const LEDGER_LIMIT=200;
const remember=<T>(map:Map<string,T>|Set<string>,key:string,value?:T)=>{
 if(map instanceof Set)map.add(key);else map.set(key,value as T);
 if(map.size>LEDGER_LIMIT)map.delete(map.keys().next().value as string);
};
const byObject=(changes:readonly LiveTapChange[])=>{
 const out=new Map<string,LiveTapChange[]>();
 for(const change of changes)out.set(change.objectApiName,[...out.get(change.objectApiName)??[],change]);
 return out;
};
/**
 * Another screen of this login tapped (a till this display follows, another kiosk window).
 * - preview: its predicted change is drawn at once, the same way that screen draws it
 *   (lists take it only where they can show it exactly; held rows and totals over them too);
 * - settled: the saved rows replace the prediction (provisional rows go, saved rows come);
 *   the database's own notice of the same rows is then skipped here (already drawn), and
 *   the server totals over those Objects are read again. ok false: nothing was saved, the
 *   page reads again what the prediction touched.
 */
export function drawLiveTap(target:PageLiveTarget,kind:'preview'|'settled',tap:LiveTap,ledger:TapLedger):Promise<unknown>{
 const work:Promise<unknown>[]=[];
 const changes=byObject(tap.changes);
 const session=target.pageSessionKey;
 if(kind==='preview'){
  // The answer came first (a slow preview): nothing to predict any more.
  if(ledger.answered.has(tap.batch))return Promise.resolve();
  const created=new Map<string,Set<string>>();
  for(const [object,list] of changes){
   work.push(target.data.saved({pageSessionKey:session,objectApiNames:[object],recordChanges:list,optimistic:tap.batch,live:true}).catch(()=>undefined));
   target.code?.applyLiveRows(object,list.filter(change=>change.operation!=='delete').map(change=>change.record),
    list.filter(change=>change.operation==='delete').map(change=>String(change.record.Id)));
   created.set(object,new Set(list.filter(change=>change.operation==='create').map(change=>String(change.record.Id))));
  }
  remember(ledger.waiting,tap.batch,created);
  return Promise.all(work);
 }
 const predicted=ledger.waiting.get(tap.batch);
 ledger.waiting.delete(tap.batch);
 remember(ledger.answered,tap.batch);
 if(!tap.ok){
  // Not saved: what the prediction showed goes back to what SQL has.
  return predicted?resyncPage(target):Promise.resolve();
 }
 const objects=new Set([...changes.keys(),...predicted?.keys()??[]]);
 // These rows are drawn now: the database notice of the same rows needs no second read.
 noteOwnWrites(tap.changes.filter(change=>change.operation!=='delete').map(change=>change.record.Id));
 for(const object of objects){
  const list=changes.get(object)??[];
  work.push(target.data.saved({pageSessionKey:session,objectApiNames:[object],recordChanges:list,replacesOptimistic:tap.batch,live:true}).catch(()=>undefined));
  target.code?.applyLiveRows(object,list.filter(change=>change.operation!=='delete').map(change=>change.record),
   [...predicted?.get(object)??[],...list.filter(change=>change.operation==='delete').map(change=>String(change.record.Id))]);
 }
 // Server totals over these Objects (display formulas over rows the page does not hold).
 if(target.code&&objects.size)work.push(target.code.liveChanged([...objects],[]).catch(()=>undefined));
 return Promise.all(work);
}

/** Read everything the page shows again (the stream was down: anything may have changed). */
export function resyncPage(target:PageLiveTarget):Promise<unknown>{
 return Promise.all([
  ...target.dataSources.map(source=>target.data.reload(source.id,true).catch(()=>undefined)),
  ...(target.code?[target.code.loadSets().catch(()=>undefined),Promise.resolve(target.code.refreshTotals()).catch(()=>undefined)]:[])
 ]);
}

/** Connect a page to the live stream; returns stop. */
export function connectPageLive(target:PageLiveTarget,
 subscribe:(listener:(event:LiveEvent)=>void)=>()=>void=subscribeLiveChanges,mergeMs=LIVE_MERGE_MS):()=>void{
 const pending=new Map<string,Pending>();
 let timer:ReturnType<typeof setTimeout>|null=null;
 let received=0;
 const flush=()=>{
  timer=null;
  const changes=[...pending.values()];pending.clear();
  if(!changes.length)return;
  // Speed timing: received -> drawn (rows patched in place now; re-reads count when they land).
  const at=received;
  queueMicrotask(()=>noteLiveDrawn(target.apiName,at,changes.map(change=>change.object).join(',')));
  void drawLiveChanges(target,changes);
 };
 const ledger=newTapLedger();
 const stop=subscribe(event=>{
  if(event.kind==='resync'){void resyncPage(target);return;}
  if(event.kind==='preview'||event.kind==='settled'){
   // Drawn at once (not merged): this is the fastest path from a till to its display.
   const at=timingNow();
   void drawLiveTap(target,event.kind,event.tap,ledger);
   queueMicrotask(()=>noteLiveDrawn(target.apiName,at,event.kind+':'+[...new Set(event.tap.changes.map(change=>change.objectApiName))].join(',')));
   return;
  }
  if(event.kind!=='change')return;
  const key=event.change.object.toLowerCase();
  pending.set(key,mergeLiveChange(pending.get(key),event.change));
  if(!timer)received=timingNow();
  timer??=setTimeout(flush,mergeMs);
 });
 return ()=>{stop();if(timer)clearTimeout(timer);timer=null;pending.clear();};
}
