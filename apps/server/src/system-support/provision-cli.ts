import {SqlPersistence} from '../system-files/sql-persistence.js';
import {TenantProvisioning} from '../system-files/tenant-provisioning.js';
const required=(name:string)=>{
  const value=process.env[name];
  if(!value)throw new Error('Missing required environment setting: '+name);
  return value;
};
async function main() {
  const db=new SqlPersistence(required('DATABASE_URL'));
  try {
    const result=await new TenantProvisioning(db).provision({
      slug:required('METADRIVE_TENANT_SLUG'),
      name:required('METADRIVE_TENANT_NAME'),
      domain:required('METADRIVE_TENANT_DOMAIN'),
      developerEmail:required('METADRIVE_TENANT_DEVELOPER_EMAIL'),
      developerPassword:required('METADRIVE_TENANT_DEVELOPER_PASSWORD')
    });
    console.info('Created SQL tenant and tenant developer role for',result.slug,result.domain);
  } finally {await db.close();}
}
main().catch((error:unknown)=>{
  console.error('Tenant provisioning failed:',error instanceof Error?error.message:'Unknown error');
  process.exitCode=1;
});
