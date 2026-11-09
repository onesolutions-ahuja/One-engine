// Till speed test: paste into the browser console on a page with a product card
// grid and a cart (Page Builder preview or the published page), then run:
//   await tillSpeedTest()                       // 3 products, default
//   await tillSpeedTest({products:['Pepsi'],taps:5})
// Reports per tap: cartMs (tap -> cart shows the change), boxesMs (tap -> last
// formula box changes), saveMs (server save round trip), and the busiest
// functions when the page allows self-profiling. Targets: cart < 200 ms,
// worst case 300 ms. It adds real cart lines: use a test session.
window.tillSpeedTest=async function tillSpeedTest({products=['Coca-Cola Original','Pepsi','Sprite'],
  taps=1,settleMs=1500,profile=true}={}){
  if(document.visibilityState!=='visible')
    console.warn('Page is hidden: the browser slows timers, so timings will be wrong.');
  window.confirm=()=>true; // Page Builder's interactive-preview prompt
  const text=selector=>[...document.querySelectorAll(selector)].map(e=>e.innerText).join('\u0001');
  const cartSig=()=>text('[class*="smart_cart"]');
  const boxSig=()=>text('[class*="smart_text"]');
  const buttons=()=>[...document.querySelectorAll('button.smart-grid-action')];
  let profiler=null;
  if(profile&&typeof Profiler==='function'){
    try{profiler=new Profiler({sampleInterval:1,maxBufferSize:100000});}catch{profiler=null;}
  }
  const results=[];
  for(let round=0;round<taps;round++)for(const name of products){
    const button=buttons().find(b=>b.textContent.includes(name));
    if(!button){results.push({name,error:'product not found'});continue;}
    const cart0=cartSig(),box0=boxSig();
    performance.clearResourceTimings();
    let cartMs=null,boxesMs=null;
    const t0=performance.now();
    const observer=new MutationObserver(()=>{
      const t=performance.now()-t0;
      if(cartMs===null&&cartSig()!==cart0)cartMs=Math.round(t);
      if(boxSig()!==box0)boxesMs=Math.round(t);
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    button.click();
    await new Promise(resolve=>setTimeout(resolve,settleMs));
    observer.disconnect();
    const save=performance.getEntriesByType('resource')
      .find(entry=>entry.name.includes('/action-formulas/execute-data'));
    const requests=performance.getEntriesByType('resource')
      .filter(entry=>entry.name.includes('/api/')&&!/health|notifications/.test(entry.name))
      .map(entry=>entry.name.split('/api')[1].split('?')[0]);
    results.push({name,cartMs,boxesMs,saveMs:save?Math.round(save.duration):null,requests});
  }
  let hot;
  if(profiler){
    const trace=await profiler.stop();
    const self=new Map();
    for(const sample of trace.samples){
      if(sample.stackId===undefined)continue;
      const frame=trace.frames[trace.stacks[sample.stackId].frameId];
      const key=(frame.name||'(anonymous)')+' '+String(trace.resources[frame.resourceId]??'').split('/').pop()+':'+frame.line+':'+frame.column;
      self.set(key,(self.get(key)??0)+1);
    }
    hot=[...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([key,count])=>key+' x'+count);
  }
  const median=values=>{const v=values.filter(x=>x!==null).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
  const summary={cartMs:median(results.map(r=>r.cartMs)),boxesMs:median(results.map(r=>r.boxesMs)),
    saveMs:median(results.map(r=>r.saveMs)),localFormulas:window.__metadriveLocalSql,taps:results,hot};
  console.table(results.map(({requests,...rest})=>rest));
  return summary;
};
