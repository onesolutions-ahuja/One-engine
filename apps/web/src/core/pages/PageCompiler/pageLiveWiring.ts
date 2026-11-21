import type {CompiledDataSource} from './compilePage';
import type {CompiledDataLayer} from './compiledPageStore';
import {subscribeLiveChanges,type LiveChange,type LiveEvent} from './liveChanges';
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
 const stop=subscribe(event=>{
  if(event.kind==='resync'){void resyncPage(target);return;}
  if(event.kind!=='change')return;
  const key=event.change.object.toLowerCase();
  pending.set(key,mergeLiveChange(pending.get(key),event.change));
  if(!timer)received=timingNow();
  timer??=setTimeout(flush,mergeMs);
 });
 return ()=>{stop();if(timer)clearTimeout(timer);timer=null;pending.clear();};
}
