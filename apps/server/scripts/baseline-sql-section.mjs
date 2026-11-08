// Read a historical test SQL section without restoring its old migration file.
// The repository has exactly one canonical migration version on disk.
import {readFileSync} from 'node:fs';
const baseline=readFileSync(new URL('../src/system-support/migrations/20261107-core-baseline.sql',import.meta.url),'utf8');
export function readBaselineMigration(name){
 if(!/^(?:\d{3}|\d{8})-[a-z0-9-]+\.sql$/.test(name)||name==='20261107-core-baseline.sql')
  throw Error('Invalid historical SQL migration name');
 const marker='-- BEGIN ORIGINAL MIGRATION '+name+'\n';
 const ending='-- END ORIGINAL MIGRATION '+name+'\n';
 const start=baseline.indexOf(marker),end=baseline.indexOf(ending,start+marker.length);
 if(start<0||end<0)throw Error('Historical SQL section missing from one baseline: '+name);
 return baseline.slice(start+marker.length,end);
}
