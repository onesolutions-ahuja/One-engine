type Flow={apiName:string;flowType?:string;status?:string};
type Launch=(name:string,inputs:Record<string,unknown>,context:{requestId:string})=>void;
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

export async function runSequenceFlow(name:string,flows:readonly Flow[],request:Request,launch:Launch){
 const flow=flows.find(item=>item.apiName===name&&item.status==='Active');
 if(!flow)throw Error('Unknown or inactive Flow: '+name);
 if(flow.flowType==='Autolaunched Flow'){
  const result=await request<{interviewId?:string}>('/flows/'+encodeURIComponent(name)+'/execute',{
   method:'POST',body:JSON.stringify({})
  });
  if(result.interviewId)throw Error('Flow paused; subsequent actions were stopped');
  return;
 }
 if(!['Screen Flow','In-Screen Flow'].includes(String(flow.flowType)))throw Error('Unsupported Flow type');
 const requestId=crypto.randomUUID();
 return new Promise<void>((resolve,reject)=>{
  const controller=new AbortController();
  const finish=(event:Event)=>{
   const detail=(event as CustomEvent<{requestId?:string}>).detail;
   if(detail?.requestId!==requestId)return;
   controller.abort();
   if(event.type==='metadrive:flow-completed')resolve();
   else reject(Error('Flow did not complete'));
  };
  for(const type of ['metadrive:flow-completed','metadrive:flow-paused','metadrive:flow-failed'])
   window.addEventListener(type,finish,{signal:controller.signal});
  try{launch(name,{}, {requestId});}catch(error){controller.abort();reject(error);}
 });
}
