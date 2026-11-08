import {SqlPersistence} from '../dist-system/system-files/sql-persistence.js';
import {PageRuntime} from '../dist-system/system-files/page-runtime.js';
import {applyCodextillDesktopLayout,codextillDesktopComponents}
  from '../dist-system/app-seeders/codextill-page-layout.js';

// The checkout is private to the runner but PostgreSQL authenticates over a
// Unix peer socket as the metadrive OS user. Resolve static imports while
// privileged, then permanently drop uid/gid before opening any SQL connection.
if(typeof process.getuid==='function' && process.getuid()===0){
 process.initgroups('metadrive','metadrive');
 process.setgid('metadrive');
 process.setuid('metadrive');
}
if(typeof process.getuid==='function' && process.getuid()===0)
 throw Error('Refusing a privileged CODEXTILL database connection');

// One-time, tenant-scoped visual draft write. No page publication, app seeding,
// user records or service manipulation. The seeder itself is checksum guarded.
if(!process.env.DATABASE_URL)throw Error('Configured DATABASE_URL required');
const db=new SqlPersistence(process.env.DATABASE_URL);
try {
 const added=await applyCodextillDesktopLayout(db);
 const pages=await db.query(
  "SELECT p.tenant_id FROM md_page_definitions p JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id WHERE p.api_name='CODEXTILL' AND p.enabled=true");
 if(pages.rows.length!==1)throw Error('Expected exactly one Page Builder CODEXTILL page');
 const draft=await new PageRuntime(db).editor(pages.rows[0].tenant_id,'CODEXTILL','Desktop');
 const nodes=new Map(draft.components.map(c=>[c.id,c]));
 for(const wanted of codextillDesktopComponents){
  const present=nodes.get(wanted.id);
  if(!present || present.type!==wanted.type
    || Object.keys(wanted.position).some(k=>present.position?.[k]!==wanted.position[k]))
   throw Error('CODEXTILL draft geometry verification failed: '+wanted.id);
 }
 console.info('CODEXTILL Desktop draft verified:',codextillDesktopComponents.length,
  'Smart Component instances with exact geometry;',added,'newly added');
}finally{
 await db.pool.end();
}
