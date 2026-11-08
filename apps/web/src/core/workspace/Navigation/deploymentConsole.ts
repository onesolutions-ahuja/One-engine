/** Live OCI console helpers. Preserve earlier log windows while the panel is open.
 * Raw snapshots are keyed by the deployed commit so old jobs cannot contaminate
 * a new deploy. The backend bounds each log snapshot to keep polls inexpensive.
 */
export type OciConsoleSnapshot = {
  sha:string|null;
  trail?:string[];
  buildLog?:string[];
  journal?:string[];
};
export type CapturedLine = {raw:string;seenAt:string};
export type ConsoleHistory = {
  sha:string|null;
  trail:CapturedLine[];
  buildLog:CapturedLine[];
  journal:CapturedLine[];
};
const MAX_HISTORY_PER_CHANNEL=1200;
function appendWindow(previous:CapturedLine[],incoming:string[],seenAt:string):CapturedLine[]{
  if(!incoming.length)return previous;
  // Identify the overlapping suffix/prefix so repeated 2-second snapshots do
  // not repeat their content. Retain the history as the server's tail rotates.
  let overlap=0;
  for(let size=Math.min(previous.length,incoming.length);size>0;size--){
    if(incoming.slice(0,size).every((line,i)=>previous[previous.length-size+i].raw===line)){
      overlap=size;
      break;
    }
  }
  if(overlap===incoming.length)return previous;
  return [...previous,...incoming.slice(overlap).map(raw=>({raw,seenAt}))]
    .slice(-MAX_HISTORY_PER_CHANNEL);
}
export function mergeConsoleSnapshot(previous:ConsoleHistory|null,snapshot:OciConsoleSnapshot,seenAt:string):ConsoleHistory{
  const old=previous?.sha===snapshot.sha?previous:null;
  return {
    sha:snapshot.sha,
    trail:appendWindow(old?.trail??[],snapshot.trail??[],seenAt),
    buildLog:appendWindow(old?.buildLog??[],snapshot.buildLog??[],seenAt),
    journal:appendWindow(old?.journal??[],snapshot.journal??[],seenAt)
  };
}
export type TerminalLine={key:string;text:string;timestamp:string};
export function terminalLines(history:ConsoleHistory|null):TerminalLine[]{
  if(!history)return [];
  const entries=[
    ...history.trail.map((line,i)=>({line,source:'STAGE',order:i*3})),
    ...history.buildLog.map((line,i)=>({line,source:'BUILD',order:i*3+1})),
    ...history.journal.map((line,i)=>({line,source:'OCI',order:i*3+2}))
  ];
  const timestampPattern=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d))\s*/;
  return entries.map(({line,source,order},index)=>{
    const match=timestampPattern.exec(line.raw);
    // Older OCI agents do not stamp npm output. Label the *receipt* time,
    // rather than misrepresenting it as the event's actual execution time.
    const stamp=match?.[1]??line.seenAt;
    const timestamp=stamp.slice(0,19)+'Z';
    const label=match?'':' (received)';
    return {key:source+':'+index+':'+line.seenAt,
      text:timestamp+' ['+source+']'+label+' '+(match?line.raw.slice(match[0].length):line.raw),
      timestamp:timestamp+'#'+String(order).padStart(8,'0')};
  }).sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).slice(-2400);
}
