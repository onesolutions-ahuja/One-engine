// Production migration smoke check from a real GitHub Actions network runner.
// Never logs credentials, cookies or user records.
const site=(process.env.METADRIVE_PAGES_URL||'https://unesolutions.co.uk').replace(/\/$/,'');
const expectedApi=process.env.METADRIVE_API_BASE_URL?.replace(/\/$/,'');
const apiCandidates=[expectedApi,'https://api.unesolutions.co.uk/api','https://metadrive-nxd7.onrender.com/api']
  .filter((value,index,all)=>Boolean(value)&&all.indexOf(value)===index);
const legacy='https://metadrive-production.up.railway.app/api';
const stamp=Date.now();
const htmlResponse=await fetch(site+'/?metadrive_probe='+stamp,{
  cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)
});
if(!htmlResponse.ok)throw new Error('Public site unavailable: HTTP '+htmlResponse.status);
const html=await htmlResponse.text();
const scripts=[...html.matchAll(/src=["'](\/assets\/[^"']+\.js)["']/g)].map(match=>match[1]);
if(!scripts.length)throw new Error('Public homepage has no Vite JavaScript entrypoint');
console.log('Public entrypoint(s):',scripts.join(', '));
let apiBinding;
let railwayFound=false;
const queue=[...scripts];
const visited=new Set();
while(queue.length&&visited.size<75){
  const path=queue.shift();
  if(!path||visited.has(path))continue;
  visited.add(path);
  const response=await fetch(site+path,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Public bundle missing: '+path+' HTTP '+response.status);
  const code=await response.text();
  apiBinding=apiCandidates.find(candidate=>code.includes(candidate))||apiBinding;
  railwayFound ||=code.includes(legacy);
  for(const match of code.matchAll(/["']\.\/([^"'?#]+\.js)["']/g)){
    const child='/assets/'+match[1];
    if(!visited.has(child)&&!queue.includes(child))queue.push(child);
  }
  if(apiBinding)break;
}
console.log('Checked public JS modules:',visited.size);
console.log('Public frontend API binding:',apiBinding||'not found');
console.log('Public frontend legacy Railway API binding:',railwayFound);
if(!apiBinding||railwayFound)throw new Error('Live frontend has no recognized SQL API binding or still references legacy Railway');
if(expectedApi&&apiBinding!==expectedApi)
  throw new Error('Published frontend API mismatch: expected '+expectedApi+' but found '+apiBinding);
// Render may be waking from idle; retry transient network timeouts without masking bad health responses.
let health;
let healthError;
for(let attempt=0;attempt<3;attempt++){
  try{
    health=await fetch(apiBinding+'/health',{cache:'no-store',signal:AbortSignal.timeout(30000)});
    break;
  }catch(error){
    healthError=error;
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,2000));
  }
}
if(!health)throw new Error('SQL API health request failed after 3 attempts: '+String(healthError));
let payload;
try{payload=await health.json();}catch{throw new Error('SQL API health returned invalid JSON: HTTP '+health.status);}
if(!health.ok||payload?.status!=='ok'||payload?.persistence!=='sql')
  throw new Error('Bound SQL API health failed: HTTP '+health.status);
const cors=await fetch(apiBinding+'/auth/login',{method:'OPTIONS',headers:{
  Origin:site,
  'Access-Control-Request-Method':'POST',
  'Access-Control-Request-Headers':'content-type,x-metadrive-request-source'
},signal:AbortSignal.timeout(20000)});
console.log('Login preflight:',cors.status,'origin:',cors.headers.get('access-control-allow-origin'),
  'credentials:',cors.headers.get('access-control-allow-credentials'));
if(cors.status!==204||cors.headers.get('access-control-allow-origin')!==site||
  cors.headers.get('access-control-allow-credentials')!=='true')
  throw new Error('Credentialed login CORS is not valid: HTTP '+cors.status);
const loginResponse=await fetch(apiBinding+'/auth/login',{
  method:'POST',
  headers:{
    Origin:site,
    'Content-Type':'application/json',
    'X-MetaDrive-Request-Source':'web-app'
  },
  body:'{}',
  signal:AbortSignal.timeout(20000)
});
if(loginResponse.status!==400 ||
  loginResponse.headers.get('access-control-allow-origin')!==site ||
  loginResponse.headers.get('access-control-allow-credentials')!=='true')
  throw new Error('Credentialed browser login endpoint response unavailable: HTTP '+loginResponse.status);
console.log('Public Pages entry, SQL API, and credentialed login POST verified');
