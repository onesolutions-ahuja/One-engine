import type {Express,Request,Response} from 'express';
import {Readable,Transform} from 'node:stream';

const maxBodyBytes=25*1024*1024;
const maxJmapRequestBytes=2*1024*1024;
const allowedCapabilities=new Set(['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission']);
const allowedJmapMethods=new Set(['Mailbox/get','Identity/get','Email/query','Email/get','Email/set','Email/import','EmailSubmission/set']);
const allowedPaths=[
 {path:/^\/\.well-known\/jmap\/?$/,method:'GET'},
 {path:/^\/jmap\/?$/,method:'POST'},
 {path:/^\/jmap\/upload\/[^/]{1,256}\/?$/,method:'POST'},
 {path:/^\/jmap\/download\/[^/]{1,256}\/[^/]{1,512}\/[^/]{1,256}\/?$/,method:'GET'}
] as const;

/**
 * Public-origin JMAP bridge for GitHub Pages. Only forwards mailbox Basic auth to
 * Stalwart; never uses the MetaDrive management API key. Register before body parsers
 * so MIME uploads can be streamed without buffering the request body in Express.
 */
export function registerStalwartJmapProxyRoutes(app:Express){
 const origins=(process.env.METADRIVE_MAIL_WEB_ORIGINS??'https://unesolutions.co.uk')
  .split(',').map(value=>value.trim()).filter(Boolean);
 app.use('/api/mail-jmap',async(req:Request,res:Response)=>{
  const origin=req.get('origin');
  if(origin){
   if(!origins.includes(origin)){
    res.status(403).json({error:'Mail webmail origin is not allowed'});return;
   }
   res.setHeader('Access-Control-Allow-Origin',origin);
   res.setHeader('Vary','Origin');
  }
  res.setHeader('Cache-Control','private, no-store');
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Accept');
   res.setHeader('Access-Control-Max-Age','600');
   res.status(204).end();return;
  }
  const targetPath=req.path;
  const segments=targetPath.split('/').filter(Boolean);
  let unsafePath=false;
  for(const segment of segments){
   try{
    const decoded=decodeURIComponent(segment);
    if(decoded==='.'||decoded==='..'||decoded.includes('/')||decoded.includes('\\'))unsafePath=true;
   }catch{unsafePath=true;}
  }
  if(unsafePath){res.status(404).json({error:'JMAP endpoint not found'});return;}
  const route=allowedPaths.find(item=>item.path.test(targetPath));
  if(!route){res.status(404).json({error:'JMAP endpoint not found'});return;}
  if(req.method!==route.method){res.status(405).setHeader('Allow',route.method);res.json({error:'Method not allowed'});return;}
  const authorization=req.get('authorization')??'';
  if(!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization)||authorization.length>8192){
   res.status(401).json({error:'Mailbox Basic authentication is required'});return;
  }
  const isJmapApi=/^\/jmap\/?$/.test(targetPath);
  const bodyLimit=isJmapApi?maxJmapRequestBytes:maxBodyBytes;
  const declaredLength=Number(req.get('content-length')??0);
  if(Number.isFinite(declaredLength)&&declaredLength>bodyLimit){
   res.status(413).json({error:isJmapApi?'JMAP request exceeds the 2 MB proxy limit':'Mail upload exceeds the 25 MB proxy limit'});return;
  }
  let tooLarge=false;
  try{
   const configured=new URL(process.env.STALWART_BASE_URL??'http://127.0.0.1:8080');
   if(!['http:','https:'].includes(configured.protocol)
    ||(configured.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(configured.hostname))){
    res.status(503).json({error:'Stalwart must use HTTPS or a loopback HTTP listener'});return;
   }
   const base=configured.href.endsWith('/')?configured.href:configured.href+'/';
   const target=new URL(targetPath.replace(/^\/+/,''),base);
   const query=req.originalUrl.indexOf('?');
   if(query>=0)target.search=req.originalUrl.slice(query);
   const headers=new Headers({authorization,accept:req.get('accept')??'application/json'});
   const contentType=req.get('content-type');
   if(contentType)headers.set('content-type',contentType);
   const isDiscovery=req.method==='GET'&&/^\/\.well-known\/jmap\/?$/.test(targetPath);
   const init:RequestInit&{duplex?:'half'}={method:req.method,headers,
    redirect:isDiscovery?'manual':'error',signal:AbortSignal.timeout(60_000)};
   if(req.method==='POST'&&isJmapApi){
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){
     const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
     size+=bytes.length;
     if(size>maxJmapRequestBytes){tooLarge=true;res.status(413).json({error:'JMAP request exceeds the 2 MB proxy limit'});return;}
     chunks.push(bytes);
    }
    const raw=Buffer.concat(chunks);
    let payload:unknown;
    try{payload=JSON.parse(raw.toString('utf8')) as unknown;}
    catch{res.status(400).json({error:'Invalid JMAP JSON request'});return;}
    if(!payload||typeof payload!=='object'||Array.isArray(payload)){
     res.status(400).json({error:'Invalid JMAP request'});return;
    }
    const request=payload as {using?:unknown;methodCalls?:unknown};
    const using=request.using;
    if(!Array.isArray(using)||using.some((value:unknown)=>typeof value!=='string'||!allowedCapabilities.has(value))){
     res.status(403).json({error:'JMAP capability is not allowed through the webmail proxy'});return;
    }
    if(!['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'].every(capability=>using.includes(capability))){
     res.status(403).json({error:'JMAP capability is not allowed through the webmail proxy'});return;
    }
    if(!Array.isArray(request.methodCalls)||request.methodCalls.length<1||request.methodCalls.length>20
      ||request.methodCalls.some(call=>!Array.isArray(call)||typeof call[0]!=='string'||!allowedJmapMethods.has(call[0]))){
     res.status(403).json({error:'JMAP method is not allowed through the webmail proxy'});return;
    }
    init.body=raw;
   }else if(req.method==='POST'){
    let bytesReceived=0;
    const limiter=new Transform({transform(chunk:Buffer,_encoding,callback){
     bytesReceived+=chunk.length;
     if(bytesReceived>maxBodyBytes){tooLarge=true;callback(new Error('Mail upload too large'));return;}
     callback(null,chunk);
    }});
    init.body=Readable.toWeb(req.pipe(limiter)) as unknown as BodyInit;
    init.duplex='half';
   }
   let upstream=await fetch(target,init);
   if(isDiscovery&&upstream.status===307){
    const location=upstream.headers.get('location');
    if(!location)throw new Error('Stalwart JMAP discovery redirect is missing its target');
    const sessionUrl=new URL(location,target);
    if(sessionUrl.origin!==configured.origin||sessionUrl.username||sessionUrl.password
      ||sessionUrl.pathname!=='/jmap/session'||sessionUrl.search||sessionUrl.hash){
     throw new Error('Stalwart JMAP discovery redirect target is not allowed');
    }
    upstream=await fetch(sessionUrl,{...init,redirect:'error'});
   }
   res.status(upstream.status);
   for(const header of ['content-type','content-disposition','www-authenticate']){
    const value=upstream.headers.get(header);if(value)res.setHeader(header,value);
   }
   res.end(Buffer.from(await upstream.arrayBuffer()));
  }catch(error){
   if(res.headersSent)return;
   if(tooLarge){res.status(413).json({error:isJmapApi?'JMAP request exceeds the 2 MB proxy limit':'Mail upload exceeds the 25 MB proxy limit'});return;}
   // Do not return upstream bodies, internal URLs, or credentials in errors.
   res.status(502).json({error:'Mail server proxy request failed'});
  }
 });
}
