import {requireAvailableMetadataName} from '../system-support/metadata-name-guard.js';
import type {SqlPersistence} from './sql-persistence.js';
import type {RbacEngine} from './rbac-engine.js';
import type {PoolClient} from 'pg';

/** Tenant-scoped SQL registry for optional administrative definitions.
 * Stable identifiers, activation and revisions are relational; validated
 * definition properties are JSONB. No JSON-file runtime fallback.
 */
export const definitionKinds = {
  'platform-events':'platformEvents',
  'email-alerts':'emailAlerts',
  'approval-processes':'approvalProcesses',
  'dashboards':'dashboards',
  'dashboard-folders':'folders',
  'dashboard-territories':'territories',
  'report-folders':'folders',
  'reports':'reports',
  'connector-providers':'providers',
  'integration-connections':'connections'
} as const;
export type DefinitionKind=keyof typeof definitionKinds;
type PlatformEventField={apiName:string;label:string;dataType:string;required:boolean;
 picklistRestricted:boolean;picklistValues:string[]};
type EmailAlertDetails={objectApiName:string;namedCredentialId:string;fromEmail:string;
 recipients:string;subject:string;body:string};
const platformEventTypes=new Set([
 'Text(255)','Long Text Area','Number','Currency','Percent','Checkbox','Date','DateTime','Picklist'
]);

export class SystemDefinitionService {
  constructor(private readonly db:SqlPersistence, private readonly rbac:RbacEngine){}
  async list(tenantId:string,userId:string,kind:DefinitionKind) {
    await this.rbac.require(tenantId,userId,'SystemDefinition:'+kind,'read');
    const {rows}=await this.db.query<{api_name:string;label:string;properties:unknown;revision:number;enabled:boolean}>(`
      SELECT api_name,label,properties,revision,enabled
      FROM md_system_definitions
      WHERE tenant_id=$1 AND kind=$2 AND enabled=true
      ORDER BY label,api_name`,[tenantId,kind]);
    const details=kind==='platform-events'
      ?await this.db.query<{event_api_name:string;description:string}>(
       'SELECT event_api_name,description FROM md_platform_event_details WHERE tenant_id=$1',
       [tenantId]):{rows:[]};
    const eventFields=kind==='platform-events'
      ?await this.db.query<{event_api_name:string;field_api:string;label:string;data_type:string;
       required:boolean;picklist_restricted:boolean}>(
       'SELECT event_api_name,field_api,label,data_type,required,picklist_restricted FROM md_platform_event_fields WHERE tenant_id=$1 ORDER BY event_api_name,sort_order,field_api',
       [tenantId]):{rows:[]};
    const picklistValues=kind==='platform-events'
      ?await this.db.query<{event_api_name:string;field_api:string;value_text:string}>(
       'SELECT event_api_name,field_api,value_text FROM md_platform_event_picklist_values WHERE tenant_id=$1 ORDER BY event_api_name,field_api,sort_order',
       [tenantId]):{rows:[]};
    const emailAlerts=kind==='email-alerts'
      ?await this.db.query<{alert_api_name:string;object_api:string;credential_id:string;
       from_email:string;recipients:string;subject:string;body:string}>(
       `SELECT alert_api_name,object_api,credential_id,from_email,recipients,subject,body
        FROM md_email_alert_details WHERE tenant_id=$1 ORDER BY alert_api_name`,[tenantId])
      :{rows:[]};
    const descriptions=new Map(details.rows.map(row=>[row.event_api_name,row.description]));
    const valuesByField=new Map<string,string[]>();
    for(const row of picklistValues.rows){
      const key=row.event_api_name+':'+row.field_api;
      valuesByField.set(key,[...(valuesByField.get(key)??[]),row.value_text]);
    }
    const fieldsByEvent=new Map<string,PlatformEventField[]>();
    for(const row of eventFields.rows){
      const fields=fieldsByEvent.get(row.event_api_name)??[];
      fields.push({apiName:row.field_api,label:row.label,dataType:row.data_type,
       required:row.required,picklistRestricted:row.picklist_restricted,
       picklistValues:valuesByField.get(row.event_api_name+':'+row.field_api)??[]});
      fieldsByEvent.set(row.event_api_name,fields);
    }
    const alertsByName=new Map(emailAlerts.rows.map(row=>[row.alert_api_name,{
      objectApiName:row.object_api,namedCredentialId:row.credential_id,fromEmail:row.from_email,
      recipients:row.recipients,subject:row.subject,body:row.body
    } satisfies EmailAlertDetails]));
    const statuses=kind==='integration-connections'
      ?await this.db.query<{connection_api:string;status:string;message:string;tested_at:Date}>(
        'SELECT connection_api,status,message,tested_at FROM md_integration_connection_tests WHERE tenant_id=$1',
        [tenantId]):{rows:[]};
    const byName=new Map(statuses.rows.map(row=>[row.connection_api,row]));
    if(kind==='platform-events'&&rows.some(row=>!descriptions.has(row.api_name)
      ||!fieldsByEvent.get(row.api_name)?.length))
      throw new Error('Platform Event relational metadata is incomplete');
    if(kind==='email-alerts'&&rows.some(row=>!alertsByName.has(row.api_name)))
      throw new Error('Email Alert relational metadata is incomplete');
    return rows.map(row=>{
      const status=byName.get(row.api_name);
      const properties=row.properties&&typeof row.properties==='object'&&!Array.isArray(row.properties)
        ?row.properties as Record<string,unknown>:{};
      return {
        ...(kind==='platform-events'||kind==='email-alerts'?{}:properties),
        ...(kind==='platform-events'?{description:descriptions.get(row.api_name)!,
         fields:fieldsByEvent.get(row.api_name)!}:{}),
        ...(kind==='email-alerts'?alertsByName.get(row.api_name)??{}:{}),
        apiName:row.api_name,id:row.api_name,name:row.api_name,label:row.label,revision:row.revision,enabled:row.enabled,
        ...(status?{testStatus:status.status,lastTestMessage:status.message,lastTestedAt:status.tested_at}:{}),
      };
    });
  }
  async save(tenantId:string,userId:string,kind:DefinitionKind,value:unknown) {
    await this.rbac.require(tenantId,userId,'SystemDefinition:'+kind,'manage');
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid definition');
    const body=value as Record<string,unknown>;
    const apiName=typeof body.apiName==='string'?body.apiName:body.name;
    if(typeof apiName!=='string'||! /^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)
      ||typeof body.label!=='string'||!body.label.trim())throw new Error('Invalid definition');
    if(/^onesys/i.test(apiName))
      throw new Error('onesys is reserved for AppExchange system metadata');
    const {apiName:_apiName,name:_name,id:_id,label,revision,enabled,...properties}=body;
    let eventDescription='';
    let eventFields:PlatformEventField[]=[];
    let emailAlert:EmailAlertDetails|undefined;
    if(kind==='email-alerts'){
      if(Object.keys(properties).some(key=>![
        'objectApiName','namedCredentialId','fromEmail','recipients','subject','body'
      ].includes(key)))throw new Error('Unsupported Email Alert metadata property');
      const email=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
      if(typeof properties.objectApiName!=='string'
        ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(properties.objectApiName)
        ||typeof properties.namedCredentialId!=='string'
        ||!/^[0-9a-f-]{36}$/i.test(properties.namedCredentialId)
        ||typeof properties.fromEmail!=='string'||!email.test(properties.fromEmail)
        ||typeof properties.recipients!=='string'||!properties.recipients.trim()
        ||properties.recipients.length>4096
        ||typeof properties.subject!=='string'||!properties.subject.trim()
        ||properties.subject.length>300||/[\r\n]/.test(properties.subject)
        ||typeof properties.body!=='string'||properties.body.length>10000)
        throw new Error('Invalid Email Alert definition');
      const {rows:credentials}=await this.db.query(`
       SELECT 1 FROM md_named_credentials
       WHERE tenant_id=$1 AND id=$2 AND protocol='SMTP' AND enabled=true`,
       [tenantId,properties.namedCredentialId]);
      if(!credentials.length)throw new Error('Email Alert SMTP credential is unavailable');
      emailAlert={
       objectApiName:properties.objectApiName,namedCredentialId:properties.namedCredentialId,
       fromEmail:properties.fromEmail,recipients:properties.recipients,
       subject:properties.subject,body:properties.body
      };
    }
    if(kind==='platform-events'){
      if(Object.keys(properties).some(key=>!['description','fields'].includes(key)))
        throw new Error('Unsupported Platform Event metadata property');
      if(properties.description!==undefined&&typeof properties.description!=='string')
        throw new Error('Invalid Platform Event description');
      eventDescription=String(properties.description??'');
      if(eventDescription.length>10000)throw new Error('Invalid Platform Event description');
      if(!Array.isArray(properties.fields)||properties.fields.length<1||properties.fields.length>100)
        throw new Error('Platform Event definitions require between 1 and 100 fields');
      const seen=new Set<string>();
      eventFields=properties.fields.map(value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid Platform Event field');
        const field=value as Record<string,unknown>;
        if(typeof field.apiName!=='string'||! /^[A-Za-z][A-Za-z0-9_]*$/.test(field.apiName)
          ||seen.has(field.apiName.toLowerCase())||typeof field.label!=='string'||!field.label.trim()
          ||field.label.length>255||typeof field.dataType!=='string'||!platformEventTypes.has(field.dataType))
          throw new Error('Invalid Platform Event field');
        if(field.required!==undefined&&typeof field.required!=='boolean'
          ||field.picklistRestricted!==undefined&&typeof field.picklistRestricted!=='boolean')
          throw new Error('Invalid Platform Event field settings');
        seen.add(field.apiName.toLowerCase());
        const rawValues=field.picklistValues;
        if(rawValues!==undefined&&(!Array.isArray(rawValues)||rawValues.length>500
          ||rawValues.some(item=>typeof item!=='string'||!item.trim()||item.length>255)))
          throw new Error('Invalid Platform Event picklist values');
        const picklistValues=field.dataType==='Picklist'&&Array.isArray(rawValues)
          ?rawValues as string[]:[];
        if(field.dataType!=='Picklist'&&(
          field.picklistRestricted===true||Array.isArray(rawValues)&&rawValues.length>0))
          throw new Error('Picklist settings require a Picklist field');
        if(field.picklistRestricted===true&&!picklistValues.length)
          throw new Error('Restricted Platform Event picklists require at least one value');
        if(new Set(picklistValues).size!==picklistValues.length)
          throw new Error('Platform Event picklist values must be unique');
        return {apiName:field.apiName,label:field.label,dataType:field.dataType,
          required:field.required===true,picklistRestricted:field.picklistRestricted===true,picklistValues};
      });
    }
    // Optional metadata must not become an unencrypted credential store.
    const hasSecret=(value:unknown):boolean=>{
      if(Array.isArray(value))return value.some(hasSecret);
      if(value && typeof value==='object')return Object.entries(value).some(([key,v])=>
        /(?:secret|password|access.?token|refresh.?token|private.?key|api.?key)/i.test(key)||hasSecret(v));
      return false;
    };
    if(hasSecret(properties))throw new Error('Credential secrets require the encrypted credential service');
    if(JSON.stringify(properties).length>65536)throw new Error('Invalid definition size');
    const expected=revision===undefined?0:revision;
    if(!Number.isSafeInteger(expected)||Number(expected)<0)throw new Error('Invalid definition revision');
    // Update an existing revision, or create a new definition only at revision zero.
    // Avoid INSERT ... WHERE expected=0 in an UPSERT: that prevents updates entirely.
    const sql=Number(expected)===0
      ? `INSERT INTO md_system_definitions(tenant_id,kind,api_name,label,properties,enabled,revision)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,1)
           ON CONFLICT(tenant_id,kind,api_name) DO NOTHING RETURNING revision`
      : `UPDATE md_system_definitions
           SET label=$4,properties=$5::jsonb,enabled=$6,revision=revision+1,updated_at=now()
           WHERE tenant_id=$1 AND kind=$2 AND api_name=$3 AND revision=$7
           RETURNING revision`;
    const persistedProperties=kind==='platform-events'||kind==='email-alerts'?{}:properties;
    const params:(string|boolean|number)[]=[tenantId,kind,apiName,label,JSON.stringify(persistedProperties),enabled!==false];
    if(Number(expected)!==0)params.push(Number(expected));
    const saveDefinition=async(client:PoolClient)=>{
      if(Number(expected)===0)await requireAvailableMetadataName(client,tenantId,'systemDefinition',apiName,{systemKind:kind});
      const {rows}=await client.query<{revision:number}>(sql,params);
      if(!rows.length)throw new Error('Definition revision conflict');
      if(kind==='email-alerts'){
        if(!emailAlert)throw new Error('Email Alert metadata is unavailable');
        const credential=await client.query<{id:string}>(`
         SELECT id FROM md_named_credentials
         WHERE tenant_id=$1 AND id=$2 AND protocol='SMTP' AND enabled=true FOR SHARE`,
         [tenantId,emailAlert.namedCredentialId]);
        if(!credential.rows[0])throw new Error('Email Alert SMTP credential is unavailable');
        await client.query(`
         INSERT INTO md_email_alert_details
          (tenant_id,alert_api_name,object_api,credential_id,from_email,recipients,subject,body)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(tenant_id,alert_api_name) DO UPDATE SET object_api=EXCLUDED.object_api,
          credential_id=EXCLUDED.credential_id,from_email=EXCLUDED.from_email,
          recipients=EXCLUDED.recipients,subject=EXCLUDED.subject,body=EXCLUDED.body`,
         [tenantId,apiName,emailAlert.objectApiName,emailAlert.namedCredentialId,
          emailAlert.fromEmail,emailAlert.recipients,emailAlert.subject,emailAlert.body]);
      }else if(kind==='platform-events'){
        await client.query(`
          INSERT INTO md_platform_event_details(tenant_id,event_api_name,description)
          VALUES($1,$2,$3)
          ON CONFLICT(tenant_id,event_api_name) DO UPDATE SET description=EXCLUDED.description`,
          [tenantId,apiName,eventDescription]);
        await client.query(
          'DELETE FROM md_platform_event_fields WHERE tenant_id=$1 AND event_api_name=$2',
          [tenantId,apiName]);
        for(const [sortOrder,field] of eventFields.entries()){
          await client.query(`
            INSERT INTO md_platform_event_fields
              (tenant_id,event_api_name,field_api,label,data_type,required,picklist_restricted,sort_order)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [tenantId,apiName,field.apiName,field.label,field.dataType,field.required,
              field.picklistRestricted,sortOrder]);
          for(const [valueOrder,valueText] of field.picklistValues.entries())
            await client.query(`
              INSERT INTO md_platform_event_picklist_values
                (tenant_id,event_api_name,field_api,value_text,sort_order)
              VALUES($1,$2,$3,$4,$5)`,
              [tenantId,apiName,field.apiName,valueText,valueOrder]);
        }
      }
      return rows[0].revision;
    };
    const savedRevision=kind==='platform-events'||kind==='email-alerts'
      ?await this.db.transaction(saveDefinition)
      :await this.db.query<{revision:number}>(sql,params).then(result=>{
        if(!result.rows.length)throw new Error('Definition revision conflict');
        return result.rows[0].revision;
      });
    return kind==='platform-events'
      ?{apiName,id:apiName,name:apiName,label,description:eventDescription,fields:eventFields,
        revision:savedRevision,enabled:enabled!==false}
      :kind==='email-alerts'&&emailAlert
      ?{...emailAlert,apiName,id:apiName,name:apiName,label,revision:savedRevision,enabled:enabled!==false}
      :{...properties,apiName,id:apiName,name:apiName,label,revision:savedRevision,enabled:enabled!==false};
  }
 /** Execute a real HTTPS credential test; failures remain visible and tenant-scoped. */
 async testConnection(tenantId:string,userId:string,apiName:string,
  run:(credentialId:string,path:string)=>Promise<{status:number}>) {
  await this.rbac.require(tenantId,userId,'SystemDefinition:integration-connections','manage');
  await this.rbac.require(tenantId,userId,'HTTPCallout','execute');
  await this.rbac.require(tenantId,userId,'NamedCredential','read');
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName))throw new Error('Invalid connection');
  const {rows}=await this.db.query<{api_name:string;label:string;properties:unknown}>(`
    SELECT api_name,label,properties FROM md_system_definitions
    WHERE tenant_id=$1 AND kind='integration-connections' AND api_name=$2 AND enabled=true`,
    [tenantId,apiName]);
  const found=rows[0];
  if(!found)throw new Error('Connection not found');
  const props=(found.properties&&typeof found.properties==='object'&&!Array.isArray(found.properties)
   ?found.properties:{}) as Record<string,unknown>;
  const config=(props.configuration&&typeof props.configuration==='object'&&!Array.isArray(props.configuration)
   ?props.configuration:{}) as Record<string,unknown>;
  const credentialId=config.namedCredentialId;
  const path=config.testPath;
  let status:'Connected'|'Failed'|'Not configured'='Not configured',message='No saved Named Credential configured';
  if(typeof credentialId==='string'&&/^[0-9a-f-]{36}$/i.test(credentialId)){
   if(path!==undefined&&(typeof path!=='string'||path.length>1024))
    throw new Error('Invalid connection test path');
   try{
    const result=await run(credentialId,typeof path==='string'?path:'');
    status='Connected';message='HTTPS connection succeeded ('+result.status+')';
   }catch{status='Failed';message='HTTPS connection test failed';}
  }
  const {rows:saved}=await this.db.query<{tested_at:Date}>(`
    INSERT INTO md_integration_connection_tests
      (tenant_id,connection_api,status,message,tested_by)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(tenant_id,connection_api)
    DO UPDATE SET status=$3,message=$4,tested_by=$5,tested_at=now()
    RETURNING tested_at`,
    [tenantId,apiName,status,message,userId]);
  return {...props,id:apiName,apiName,name:apiName,label:found.label,
    testStatus:status,lastTestMessage:message,lastTestedAt:saved[0]?.tested_at??new Date()};
 }

 async remove(tenantId:string,userId:string,kind:DefinitionKind,apiName:string){
  await this.rbac.require(tenantId,userId,'SystemDefinition:'+kind,'manage');
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName))throw new Error('Invalid definition');
  // Soft deletion preserves versioned customer metadata and relationships.
  const {rowCount}=await this.db.query(
   'UPDATE md_system_definitions SET enabled=false,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND kind=$2 AND api_name=$3 AND enabled=true',
   [tenantId,kind,apiName]);
  if(!rowCount)throw new Error('Definition not found');
 }

}
