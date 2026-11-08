import assert from 'node:assert/strict';
import {once} from 'node:events';
const files=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const [{SqlPersistence},{createSystemServer}]=await Promise.all([
 import(new URL('sql-persistence.js',files).href),import(new URL('server.js',support).href)
]);
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url)throw new Error('Isolated SQL test database is required');
const db=new SqlPersistence(url);
let server;
try{
 const before=(await db.query('SELECT count(*)::integer AS n FROM md_sessions')).rows[0].n;
 server=createSystemServer(db).listen(0,'127.0.0.1');
 await once(server,'listening');
 const addr=server.address();
 if(!addr||typeof addr==='string')throw new Error('No listener address');
 const base='http://127.0.0.1:'+addr.port;
 const call=async(route,method='GET',body,authorization)=>{
  const response=await fetch(base+route,{
   method,headers:{...(body?{'content-type':'application/json'}:{}),
    ...(authorization?{authorization}: {})},
   ...(body?{body:JSON.stringify(body)}:{})
  });
  return {status:response.status,payload:await response.text()};
 };
 const ok=await call('/api/health');
 assert.equal(ok.status,200);
 const unauth=await call('/api/job-admin/jobs?status=failed');
 assert.equal(unauth.status,401);
 const spoofed=await call('/api/job-admin/jobs?status=failed','GET',undefined,'Bearer untrusted');
 assert.equal(spoofed.status,401);
 const record=await call('/api/records/Product');
 assert.equal(record.status,401);
 const malformed=await call('/api/auth/login','POST',{email:'invalid'});
 assert.equal(malformed.status,400);
 const invalidLogin=await call('/api/auth/login','POST',{
  tenantSlug:'ci-isolated-tenant',email:'ci-user@example.invalid',password:'invalid-password'
 });
 assert.equal(invalidLogin.status,401);
 for(const [endpoint,body] of [
  ['/api/auth/mfa/verify',{challenge_token:'invalid',code:'000000'}],
  ['/api/auth/password-reset/confirm',{email:'not-a-user@example.invalid',token:'invalid',newPassword:'x'}]
 ]){
  const response=await call(endpoint,'POST',body);
  assert.notEqual(response.status,200,endpoint+' accepted invalid proof');
 }
 const badOauth=await call('/api/oauth/callback?state=invalid&code=invalid');
 assert.notEqual(badOauth.status,200);
 const after=(await db.query('SELECT count(*)::integer AS n FROM md_sessions')).rows[0].n;
 assert.equal(after,before,'rejected authentication requests created SQL sessions');
 console.info('Live local SQL HTTP negative auth, MFA/OAuth and RBAC checks: PASS');
}finally{
 if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 await db.close();
}
