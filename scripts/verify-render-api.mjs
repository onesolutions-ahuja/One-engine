// Production release preflight: verify the selected SQL API and the real frontend origin.
const api=(process.env.METADRIVE_API_BASE_URL??'https://metadrive-nxd7.onrender.com/api').replace(/\/$/,'');
const origin='https://unesolutions.co.uk';
const health=await fetch(api+'/health',{signal:AbortSignal.timeout(30000),cache:'no-store'});
if(!health.ok)throw new Error('SQL API health unavailable: HTTP '+health.status);
const payload=await health.json();
if(payload.status!=='ok'||payload.persistence!=='sql')throw new Error('API returned an unhealthy SQL result');
const preflight=await fetch(api+'/auth/login',{
  method:'OPTIONS',
  headers:{
    Origin:origin,
    'Access-Control-Request-Method':'POST',
    'Access-Control-Request-Headers':'content-type,x-metadrive-request-source'
  },
  signal:AbortSignal.timeout(30000)
});
if(preflight.status!==204 ||
  preflight.headers.get('access-control-allow-origin')!==origin ||
  preflight.headers.get('access-control-allow-credentials')!=='true')
  throw new Error('API blocks credentialed production browser CORS: HTTP '+preflight.status);
const login=await fetch(api+'/auth/login',{
  method:'POST',
  headers:{Origin:origin,'Content-Type':'application/json','X-MetaDrive-Request-Source':'web-app'},
  body:'{}',
  signal:AbortSignal.timeout(30000)
});
if(login.status!==400 ||
  login.headers.get('access-control-allow-origin')!==origin ||
  login.headers.get('access-control-allow-credentials')!=='true')
  throw new Error('API login endpoint/browser CORS unavailable: HTTP '+login.status);
console.log('SQL API health and credentialed production browser CORS verified:',api);
