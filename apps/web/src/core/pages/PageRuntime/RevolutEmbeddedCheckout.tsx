import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';

type CheckoutMode='sandbox'|'prod';
type CheckoutSdk={embeddedCheckout(options:{
 publicToken:string;mode:CheckoutMode;locale:'auto';target:HTMLElement;
 createOrder:()=>Promise<{publicId:string}>;
 onSuccess:(value:{orderId:string})=>void;
 onError:(value:{error:{message?:string};orderId?:string})=>void;
 onCancel:(value:{orderId?:string})=>void;
}):Promise<{destroy:()=>void}>};
declare global {
 interface Window { RevolutCheckout?:CheckoutSdk;__REV_PAY_VERSION__?:string; }
}
const loading=new Map<CheckoutMode,Promise<CheckoutSdk>>();
function loadScript(src:string):Promise<void>{
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=src;script.async=true;
  script.onload=()=>resolve();
  script.onerror=()=>{script.remove();reject(new Error('Revolut Checkout SDK could not be loaded'));};
  document.head.appendChild(script);
 });
}
/** Revolut's published embed-script bootstrap, isolated by Sandbox/Production mode. */
function loadSdk(mode:CheckoutMode):Promise<CheckoutSdk>{
 const existing=loading.get(mode);
 if(existing)return existing;
 const host=mode==='sandbox'?'https://sandbox-merchant.revolut.com':'https://merchant.revolut.com';
 const pending=(async()=>{
  // The version endpoint is advisory: the official embed script also supports
  // loading with an empty version when the version lookup is unavailable.
  let version='';
  try{
   await loadScript(host+'/version.js?version='+encodeURIComponent(String(Date.now())));
   version=typeof window.__REV_PAY_VERSION__==='string'?window.__REV_PAY_VERSION__:'';
   delete window.__REV_PAY_VERSION__;
  }catch{/* Fall back to Revolut's unversioned script. */}
  await loadScript(host+'/embed.js'+(version?'?version='+encodeURIComponent(version):''));
  const sdk=window.RevolutCheckout;
  if(!sdk||typeof sdk.embeddedCheckout!=='function')
   throw Error('Revolut embedded checkout is not available');
  // Save this environment's instance. Revolut's loader can switch modes later.
  return sdk;
 })();
 loading.set(mode,pending);
 pending.catch(()=>{if(loading.get(mode)===pending)loading.delete(mode);});
 return pending;
}
type Status='loading'|'ready'|'awaiting'|'completed'|'failed'|'cancelled';
export default function RevolutEmbeddedCheckout({recordId}:{recordId:string}){
 const target=useRef<HTMLDivElement>(null);
 const created=useRef<string>('');
 const [status,setStatus]=useState<Status>('loading');
 const [error,setError]=useState('');
 const [currency,setCurrency]=useState('');
 useEffect(()=>{
  if(!recordId){setStatus('failed');setError('Open a payment record to start checkout.');return;}
  let alive=true,instance:{destroy:()=>void}|null=null;
  const attemptKey=crypto.randomUUID();
  created.current='';
  setStatus('loading');setError('');
  void (async()=>{
   try{
    const config=await apiRequest<{publicKey:string;mode:CheckoutMode;currency:string}>('/revolut/checkout/config',{cache:'no-store'});
    if(!alive||!target.current)return;
    if(config.mode!=='sandbox'&&config.mode!=='prod')throw Error('Invalid checkout environment');
    setCurrency(config.currency);
    const sdk=await loadSdk(config.mode);
    if(!alive||!target.current)return;
    instance=await sdk.embeddedCheckout({
     publicToken:config.publicKey,mode:config.mode,locale:'auto',target:target.current,
     createOrder:async()=>{
      // The server derives the amount from the authorised tenant record. The
      // browser never submits a price, currency, object or secret API key.
      const order=await apiRequest<{id:string;token:string}>('/revolut/checkout/orders',{
       method:'POST',body:JSON.stringify({recordId,attemptKey})
      });
      if(!alive)throw Error('Checkout closed');
      created.current=order.id;
      setStatus('awaiting');
      return {publicId:order.token};
     },
     onSuccess:()=>{if(alive)setStatus('awaiting');},
     onError:({error})=>{if(alive){setError(error?.message||'Payment could not be processed');setStatus('failed');}},
     onCancel:()=>{if(alive)setStatus('cancelled');}
    });
    if(!alive)instance.destroy();
    else setStatus(current=>current==='loading'?'ready':current);
   }catch(cause){
    if(alive){setStatus('failed');setError(cause instanceof Error?cause.message:'Checkout unavailable');}
   }
  })();
  return()=>{alive=false;instance?.destroy();};
 },[recordId]);
 useEffect(()=>{
  if(status!=='awaiting'||!created.current)return;
  let alive=true,busy=false;
  const check=async()=>{
   if(!alive||busy)return;
   busy=true;
   try{
    const result=await apiRequest<{status:string}>('/revolut/checkout/orders/'+encodeURIComponent(created.current),{cache:'no-store'});
    if(!alive)return;
    if(result.status==='completed')setStatus('completed');
    if(result.status==='failed')setStatus('failed');
    if(result.status==='cancelled')setStatus('cancelled');
   }catch{/* Network interruptions do not falsely mark a payment complete. */}
   finally{busy=false;}
  };
  void check();
  const interval=window.setInterval(()=>void check(),3000);
  return()=>{alive=false;window.clearInterval(interval);};
 },[status]);
 return <section aria-label="Revolut Checkout" className="surface" style={{padding:16,maxWidth:640,width:'100%',margin:'0 auto'}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:12}}>
   <strong>Secure payment</strong><span style={{fontSize:12,opacity:0.7}}>{currency||'Revolut'}</span>
  </div>
  {status==='loading'&&<p role="status">Loading secure checkout…</p>}
  {status==='awaiting'&&<p role="status">Processing payment. Waiting for verified payment confirmation…</p>}
  {status==='completed'&&<p role="status" style={{fontWeight:600}}>Payment confirmed. Your order is paid.</p>}
  {status==='failed'&&<p role="alert">{error||'Payment failed. Please check the payment details.'}</p>}
  {status==='cancelled'&&<p role="status">Payment cancelled.</p>}
  <div ref={target} style={{width:'100%',minHeight:status==='completed'?0:220,
   display:status==='completed'||status==='cancelled'?'none':undefined}}/>
  <small style={{opacity:0.7}}>Payment confirmation comes from Revolut's signed webhook, not the browser response.</small>
 </section>;
}
