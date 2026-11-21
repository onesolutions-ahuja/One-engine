/*
 * Live tap check: does a screen that follows another show every tap as fast as the tapping
 * screen, in order, never stepping back, including the first item of a new sale?
 * Generic: any page with page code (till, kiosk...) and any page following it (display).
 *
 * Use (two tabs of the same browser, signed in):
 *  1. Follower tab (in front): paste DISPLAY part, run  tapCheck.install()
 *  2. Tapping tab: paste TAPPER part, run  await tapCheck.run({cards:[...], clear:'Clear sale', confirm:'Yes'})
 *     It returns the tapping screen's own counts and the tap times.
 *  3. Follower tab: tapCheck.report(runResult)  -> per case: follower counts, step backs, times.
 * Defaults fit pages whose rows are `.smart-cart-row` and whose tap targets are
 * `article.smart-card`; pass selectors for other apps.
 */

// ---------- DISPLAY (follower) ----------
window.tapCheck=window.tapCheck||{};
tapCheck.install=(options={})=>{
 const rowSel=options.rows||'.smart-cart-row';
 tapCheck.rowSel=rowSel;
 tapCheck.draws=[];tapCheck.events=[];
 const rows=()=>[...document.querySelectorAll(rowSel)].map(row=>row.innerText.replace(/\s+/g,' ').trim());
 const total=()=>(document.body.innerText.match(new RegExp((options.total||'Total to pay')+'\\s*\\n?\\s*([^\\n]+)'))||[])[1]||'';
 let last='';
 tapCheck.obs?.disconnect();
 tapCheck.obs=new MutationObserver(()=>{const now=JSON.stringify([rows(),total()]);if(now!==last){last=now;tapCheck.draws.push([Date.now(),rows(),total()]);}});
 tapCheck.obs.observe(document.body,{subtree:true,childList:true,characterData:true});
 // The live stream's events, as they arrive (decoder is shared by the open stream).
 if(!TextDecoder.prototype.__tapCheck){
  const decode=TextDecoder.prototype.decode;
  TextDecoder.prototype.decode=function(...args){
   const text=decode.apply(this,args);
   if(text&&/event: (preview|settled|change)/.test(text))for(const block of text.split('\n\n')){
    const name=(block.match(/event: (\w+)/)||[])[1],data=(block.match(/data: (.*)/)||[])[1];
    if(!name||!data)continue;
    try{tapCheck.events.push([Date.now(),name,JSON.parse(data)]);}catch{tapCheck.events.push([Date.now(),name,'(split)']);}
   }
   return text;
  };
  TextDecoder.prototype.__tapCheck=true;
 }
 return 'installed: '+rows().length+' rows, total '+total();
};
const quantityOf=(rowText,name)=>{
 if(!rowText.startsWith(name+' '))return null;
 const match=rowText.match(/− (\d+) \+/)||rowText.match(/ (\d+) [£$€]/);
 return match?Number(match[1]):null;
};
tapCheck.report=(result)=>result.cases.map(item=>{
 const end=item.at+(item.window||3500);
 const seen=[];
 for(const [at,rows,total] of tapCheck.draws.filter(([at])=>at>=item.at&&at<end)){
  const quantity=rows.map(row=>quantityOf(row,item.name)).find(value=>value!==null)??0;
  if(!seen.length||seen.at(-1).q!==quantity||seen.at(-1).total!==total)seen.push({ms:at-item.at,q:quantity,total});
 }
 const counts=seen.map(step=>step.q).filter((value,index,list)=>index===0||value!==list[index-1]);
 const stepBack=counts.some((value,index)=>index>0&&value<counts[index-1]);
 const want=item.expect;
 const done=seen.find(step=>step.q===want);
 const totalDone=seen.find(step=>step.total===seen.at(-1)?.total);
 return {case:item.label,name:item.name,till:item.till,display:counts.join(','),stepBack,
  taps:item.taps,shown:done?done.ms+' ms':'NOT SHOWN',afterLastTap:done?(done.ms-lastTap)+' ms':'-',totalAt:totalDone?totalDone.ms+' ms':'-',
  ok:Boolean(done)&&!stepBack&&counts.at(-1)===want};
});
tapCheck.trace=(at,ms=2500)=>tapCheck.events.filter(([time])=>time>=at-100&&time<at+ms).map(([time,name,data])=>{
 if(typeof data!=='object')return (time-at)+' '+name+' '+data;
 const short=change=>change.objectApiName+'.'+change.operation+' '+String(change.record.Id).slice(0,8)
  +(change.record.Quantity!=null?' q'+change.record.Quantity:'')+(change.record.Cart?' cart '+String(change.record.Cart).slice(0,8):'');
 if(name==='change')return (time-at)+' change '+data.object+' '+(data.rows||[]).map(row=>String(row.Id).slice(0,8)+(row.Quantity!=null?' q'+row.Quantity:'')).join(',');
 return (time-at)+' '+name+' '+data.batch+' '+(data.changes||[]).map(short).join(' | ');
});

// ---------- TAPPER (tapping screen) ----------
tapCheck.run=async(options={})=>{
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const rowSel=options.rows||'.smart-cart-row',cardSel=options.cardSelector||'article.smart-card';
 const button=text=>[...document.querySelectorAll('button')].find(item=>item.innerText.trim()===text);
 const cards=()=>[...document.querySelectorAll(cardSel)];
 const nameOf=card=>card.innerText.split('\n')[0].trim();
 const own=name=>{const row=[...document.querySelectorAll(rowSel)].map(item=>item.innerText.replace(/\s+/g,' ').trim())
  .map(text=>quantityOf(text,name)).find(value=>value!==null);return row??0;};
 const watch=name=>{const log=[];let last=own(name);const obs=new MutationObserver(()=>{const value=own(name);if(value!==last){last=value;log.push(value);}});
  obs.observe(document.body,{subtree:true,childList:true,characterData:true});return ()=>{obs.disconnect();return log.join(',');};};
 const clearSale=async()=>{
  button(options.clear||'Clear sale')?.click();
  let yes;for(let i=0;i<30&&!(yes=button(options.confirm||'Yes'));i++)await wait(100);
  yes?.click();await wait(2500);
 };
 // Taps are spaced with message-channel steps, not timers: a background tab's timers are
 // slowed to 1 s, which would test the browser, not the app. Each step lets the page work.
 const wait=ms=>new Promise(resolve=>{const end=performance.now()+ms;const channel=new MessageChannel();
  channel.port1.onmessage=()=>{if(performance.now()>=end){channel.port1.close();resolve();}else channel.port2.postMessage(0);};
  channel.port2.postMessage(0);});
 const tap=async(card,count,gap)=>{const name=nameOf(card);const before=own(name);const stop=watch(name);const at=Date.now();
  const taps=[];
  for(let i=0;i<count;i++){taps.push(Date.now()-at);card.click();if(i<count-1)await wait(gap);}
  await wait(3500);return {name,at,taps:taps.join(','),till:stop(),expect:before+count};};
 const picks=options.cards||[8,3,10,0,1,2];
 const cases=[];
 const steps=new Set(options.steps||['first','new','existing','clearFast']);
 // a) First item after Clear sale, three times (each on a fresh sale).
 if(steps.has('first'))for(const index of picks.slice(0,3)){await clearSale();cases.push({label:'first item after Clear sale',...await tap(cards()[index],1,0)});}
 // b) 4 fast taps on a product not yet in the sale (new line), then on one already in it.
 if(steps.has('new'))for(const index of picks.slice(3,5))cases.push({label:'4 fast taps, new line',...await tap(cards()[index],4,options.gap||150)});
 if(steps.has('existing'))cases.push({label:'4 fast taps, line already there',...await tap(cards()[picks[3]],4,options.gap||150)});
 // c) Clear sale then 4 fast taps at once (first item of a new sale, fast).
 if(steps.has('clearFast')){await clearSale();
  cases.push({label:'Clear sale, then 4 fast taps',...await tap(cards()[picks[5]],4,options.gap||150)});}
 return {cases};
};
