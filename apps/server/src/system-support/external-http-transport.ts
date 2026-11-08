import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';

export function publicIp(address:string):boolean{
 if(isIP(address)===4){
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||
   a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||
   a===198&&b>=18&&b<=19||a===192&&b===0||a===192&&b===88||
   a===198&&b===51||a===203&&b===0||a===192&&b===0&&c===0);
 }
 if(isIP(address)===6){
  const normalized=address.toLowerCase();
  return !(normalized.startsWith('::')||/^(ff|fc|fd|fe8|fe9|fea|feb)/.test(normalized)||
   normalized.includes(':ffff:'));
 }
 return false;
}

export function publicHttpsUrl(raw:string):URL{
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||
  (url.port&&url.port!=='443')||isIP(url.hostname)||
  url.hostname==='localhost'||url.hostname.endsWith('.local'))
  throw new Error('External HTTP requests require a public HTTPS origin');
 return url;
}

type ExternalRequestOptions={
 method:string;
 headers?:Record<string,string>;
 body?:string;
 timeoutMs:number;
 maxResponseBytes:number;
};

export async function requestExternalHttps(url:URL,options:ExternalRequestOptions){
 for(const configured of [process.env.METADRIVE_AUTH_PUBLIC_ORIGIN,
  process.env.METADRIVE_PASSWORD_RESET_ORIGIN]){
  if(configured&&new URL(configured).origin===url.origin)
   throw new Error('HTTP Callouts cannot target MetaDrive internal APIs');
 }
 const addresses=await lookup(url.hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(address=>!publicIp(address.address)))
  throw new Error('External HTTP destination resolves to a restricted network');
 const selected=addresses[0];
 return new Promise<{status:number;body:string;responseBytes:number}>((resolve,reject)=>{
  const req=request(url,{method:options.method,headers:options.headers,agent:false,
   timeout:options.timeoutMs,
   lookup:(_hostname,lookupOptions,callback)=>lookupOptions.all
    ?callback(null,[{address:selected.address,family:selected.family}])
    :callback(null,selected.address,selected.family)},response=>{
     const chunks:Buffer[]=[];let length=0;
     response.on('data',(chunk:Buffer)=>{
      length+=chunk.length;
      if(length>options.maxResponseBytes){
       req.destroy(new Error('External HTTP response exceeded limit'));
       return;
      }
      chunks.push(chunk);
     });
     response.on('error',reject);
     response.on('end',()=>resolve({status:response.statusCode??0,
      body:Buffer.concat(chunks).toString('utf8'),responseBytes:length}));
    });
  req.on('timeout',()=>req.destroy(new Error('External HTTP request timed out')));
  req.on('error',reject);
  req.end(options.body);
 });
}
