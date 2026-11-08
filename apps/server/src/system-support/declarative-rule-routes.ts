import {requireAvailableMetadataName} from './metadata-name-guard.js';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {validateFlowFormula,flowFormulaReferences,inferFlowFormulaType,type FormulaValueType} from '../system-files/flow-formula-runtime.js';
type Actor={tenant_id:string;user_id:string};
type AuthRequest=Request & {actor?:Actor};
const api=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const route=(fn:(req:AuthRequest,res:Response)=>Promise<void>)=>
  (req:Request,res:Response,next:NextFunction)=>{void fn(req as AuthRequest,res).catch(next);};
function actor(req:AuthRequest):Actor {
  if(!req.actor)throw new Error('Permission denied');
  return req.actor;
}
const typeOfField=(dataType:string,formulaReturnType:string|null):FormulaValueType=>{
  const type=dataType==='formula'?(formulaReturnType??'Text'):dataType;
  switch(type.toLowerCase()){
    case 'boolean':case 'checkbox':return 'Checkbox';
    case 'number':case 'currency':case 'percent':case 'autonumber':case 'rollup':return 'Number';
    case 'date':return 'Date';
    case 'datetime':return 'DateTime';
    case 'time':return 'Time';
    case 'picklist':return 'Picklist';
    case 'multipicklist':return 'MultiPicklist';
    case 'geolocation':return 'Geolocation';
    default:return 'Text';
  }
};
async function inferRuleType(db:SqlPersistence,tenantId:string,objectApi:string,expression:string,
  context:'validation_rule'|'formula_field'='validation_rule'){
  const {rows}=await db.query<{api_name:string;data_type:string;formula_return_type:string|null}>(
    `SELECT api_name,data_type,formula_return_type FROM md_field_definitions
      WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL`,[tenantId,objectApi]);
  const fieldTypes=new Map(rows.map(f=>[f.api_name,typeOfField(f.data_type,f.formula_return_type)]));
  const resolve=(reference:string):FormulaValueType|null=>{
    if(['$User.Id','$User.Name','$User.Email','$User.TimeZone','$Profile.Name'].includes(reference))
      return 'Text';
    const field=reference.startsWith('$Record.')?reference.slice(8):
      reference.startsWith('$Record__Prior.')?reference.slice(15):
      reference.startsWith(objectApi+'.')?reference.slice(objectApi.length+1):reference;
    return fieldTypes.get(field)??null;
  };
  return inferFlowFormulaType(expression,resolve,context);
}
export function registerDeclarativeRuleRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
  const base='/api/metadata/objects/:objectApi';
  const requireManage=async(req:AuthRequest)=>{
    const a=actor(req);
    if(!api.test(req.params.objectApi))throw new Error('Invalid object API name');
    await rbac.require(a.tenant_id,a.user_id,'ObjectDefinition','manage');
    const {rowCount}=await db.query(
      'SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',
      [a.tenant_id,req.params.objectApi]);
    if(!rowCount)throw new Error('Object not found');
    return a;
  };
  app.get(base+'/validation-rules',route(async(req,res)=>{
    const a=await requireManage(req);
    const {rows}=await db.query(
      `SELECT api_name AS "apiName",label,expression,error_message AS "errorMessage",
       error_field_api AS "errorFieldApi",active,sort_order AS "sortOrder",revision
       FROM md_validation_rules WHERE tenant_id=$1 AND object_api=$2 ORDER BY sort_order,api_name`,
      [a.tenant_id,req.params.objectApi]);res.json({rules:rows});
  }));
  app.put(base+'/validation-rules/:ruleApi',route(async(req,res)=>{
    const a=await requireManage(req),rule=req.body;
    if(!api.test(req.params.ruleApi)||!rule||typeof rule!=='object'||Array.isArray(rule)
      ||typeof rule.label!=='string'||!rule.label.trim()||rule.label.length>160
      ||typeof rule.expression!=='string'||rule.expression.length>4000
      ||typeof rule.errorMessage!=='string'||!rule.errorMessage.trim()||rule.errorMessage.length>1000
      ||(rule.errorFieldApi!==null&&rule.errorFieldApi!==undefined&&!api.test(rule.errorFieldApi))
      ||(rule.active!==undefined&&typeof rule.active!=='boolean')
      ||(rule.sortOrder!==undefined&&(!Number.isSafeInteger(rule.sortOrder)||Math.abs(rule.sortOrder)>1000000)))
      throw new Error('Invalid validation rule');
    validateFlowFormula(rule.expression,'validation_rule');
    if(await inferRuleType(db,a.tenant_id,req.params.objectApi,rule.expression,'validation_rule')!=='Checkbox')
      throw new Error('Invalid validation rule: formula must return Checkbox');
    const fields=flowFormulaReferences(rule.expression)
      .filter(ref=>ref.startsWith('$Record.')||ref.startsWith('$Record__Prior.'))
      .map(ref=>ref.startsWith('$Record.')?ref.slice(8):ref.slice(15));
    if(rule.errorFieldApi)fields.push(rule.errorFieldApi);
    const unique=[...new Set(fields)];
    if(unique.length){
      const found=await db.query<{api_name:string}>(`SELECT api_name FROM md_field_definitions
        WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL AND api_name=ANY($3::text[])`,
      [a.tenant_id,req.params.objectApi,unique]);
      if(found.rowCount!==unique.length)throw new Error('Invalid validation rule field reference');
    }
    const provided=rule.revision;
    if(!Number.isSafeInteger(provided)||provided<0)
      throw new Error('Invalid validation rule revision');
    const revision=await db.transaction(async client=>{
      const {rows:existing}=await client.query<{
        revision:number;label:string;expression:string;error_message:string;
        error_field_api:string|null;active:boolean;sort_order:number
      }>(`SELECT revision,label,expression,error_message,error_field_api,active,sort_order
        FROM md_validation_rules WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 FOR UPDATE`,
        [a.tenant_id,req.params.objectApi,req.params.ruleApi]);
      const current=existing[0];
      if((current?.revision??0)!==provided)throw new Error('Rule revision conflict');
      if(current)await client.query(`INSERT INTO md_validation_rule_history
        (tenant_id,object_api,rule_api,revision,label,expression,error_message,error_field_api,active,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.tenant_id,req.params.objectApi,req.params.ruleApi,current.revision,current.label,
        current.expression,current.error_message,current.error_field_api,current.active,current.sort_order]);
      const last=await client.query<{max_revision:number}>(`SELECT COALESCE(MAX(revision),0)::integer AS max_revision
        FROM md_validation_rule_history WHERE tenant_id=$1 AND object_api=$2 AND rule_api=$3`,
        [a.tenant_id,req.params.objectApi,req.params.ruleApi]);
      const next=current?current.revision+1:Number(last.rows[0]?.max_revision??0)+1;
      if(!current)await requireAvailableMetadataName(client,a.tenant_id,'validationRule',req.params.ruleApi,{objectApi:req.params.objectApi});
      await client.query(`INSERT INTO md_validation_rules
        (tenant_id,object_api,api_name,label,expression,error_message,error_field_api,active,sort_order,revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(tenant_id,object_api,api_name) DO UPDATE SET
         label=EXCLUDED.label,expression=EXCLUDED.expression,error_message=EXCLUDED.error_message,
         error_field_api=EXCLUDED.error_field_api,active=EXCLUDED.active,sort_order=EXCLUDED.sort_order,
         revision=EXCLUDED.revision,updated_at=now()`,
        [a.tenant_id,req.params.objectApi,req.params.ruleApi,rule.label.trim(),
         rule.expression,rule.errorMessage.trim(),rule.errorFieldApi??null,
         rule.active??false,rule.sortOrder??0,next]);
      return next;
    });
    res.json({saved:true,revision});
  }));
  app.get(base+'/validation-rules/:ruleApi/history',route(async(req,res)=>{
    const a=await requireManage(req);
    if(!api.test(req.params.ruleApi))throw new Error('Invalid rule API name');
    const {rows}=await db.query(`SELECT revision,label,expression,
      error_message AS "errorMessage",error_field_api AS "errorFieldApi",
      active,sort_order AS "sortOrder",saved_at AS "savedAt"
      FROM md_validation_rule_history
      WHERE tenant_id=$1 AND object_api=$2 AND rule_api=$3 ORDER BY revision DESC`,
      [a.tenant_id,req.params.objectApi,req.params.ruleApi]);
    res.json({history:rows});
  }));
  app.delete(base+'/validation-rules/:ruleApi',route(async(req,res)=>{
    const a=await requireManage(req);
    if(!api.test(req.params.ruleApi))throw new Error('Invalid rule API name');
    const match=req.get('if-match');
    const expected=match&&/^"[0-9]+"$/.test(match)?Number(match.slice(1,-1)):NaN;
    if(!Number.isSafeInteger(expected)||expected<1)throw new Error('Invalid rule revision precondition');
    await db.transaction(async client=>{
      const {rows}=await client.query<{
        revision:number;label:string;expression:string;error_message:string;
        error_field_api:string|null;active:boolean;sort_order:number
      }>(`DELETE FROM md_validation_rules WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
        AND revision=$4 RETURNING revision,label,expression,error_message,error_field_api,active,sort_order`,
        [a.tenant_id,req.params.objectApi,req.params.ruleApi,expected]);
      if(!rows[0])throw new Error('Rule revision conflict');
      await client.query(`INSERT INTO md_validation_rule_history
        (tenant_id,object_api,rule_api,revision,label,expression,error_message,error_field_api,active,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.tenant_id,req.params.objectApi,req.params.ruleApi,rows[0].revision,rows[0].label,
         rows[0].expression,rows[0].error_message,rows[0].error_field_api,rows[0].active,
         rows[0].sort_order]);
    });
    res.status(204).end();
  }));
  app.get(base+'/default-formulas',route(async(req,res)=>{
    const a=await requireManage(req);
    const {rows}=await db.query(`SELECT field_api AS "fieldApi",expression,revision FROM md_field_default_formulas
      WHERE tenant_id=$1 AND object_api=$2 ORDER BY field_api`,[a.tenant_id,req.params.objectApi]);
    res.json({defaults:rows});
  }));
  app.put(base+'/default-formulas/:fieldApi',route(async(req,res)=>{
    const a=await requireManage(req),field=req.params.fieldApi,expression=req.body?.expression;
    if(!api.test(field)||typeof expression!=='string'||!expression.trim()||expression.length>4000)
      throw new Error('Invalid default formula');
    validateFlowFormula(expression,'formula_field');
    const {rows}=await db.query<{data_type:string}>(
      `SELECT data_type FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2
        AND api_name=$3 AND deleted_at IS NULL`,[a.tenant_id,req.params.objectApi,field]);
    if(!rows.length||['autonumber','formula','rollup','encryptedtext','reference'].includes(rows[0].data_type))
      throw new Error('Invalid default formula target');
    const inferred=await inferRuleType(db,a.tenant_id,req.params.objectApi,expression,'formula_field');
    const expected=typeOfField(rows[0].data_type,null);
    if(inferred!==expected&&inferred!=='Null'
      &&!(expected==='Text'&&['Text','Picklist'].includes(inferred))
      &&!(expected==='Picklist'&&inferred==='Text'))
      throw new Error('Invalid default formula result type');
    const references=flowFormulaReferences(expression);
    if(references.some(ref=>ref.startsWith('$Record__Prior')))
      throw new Error('Invalid default formula reference');
    const provided=req.body?.revision;
    if(!Number.isSafeInteger(provided)||provided<0)
      throw new Error('Invalid default formula revision');
    const revision=await db.transaction(async client=>{
      const {rows:existing}=await client.query<{revision:number;expression:string}>(`
        SELECT revision,expression FROM md_field_default_formulas
        WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 FOR UPDATE`,
        [a.tenant_id,req.params.objectApi,field]);
      const current=existing[0];
      if((current?.revision??0)!==provided)throw new Error('Rule revision conflict');
      if(current)await client.query(`INSERT INTO md_field_default_formula_history
        (tenant_id,object_api,field_api,revision,expression) VALUES($1,$2,$3,$4,$5)`,
        [a.tenant_id,req.params.objectApi,field,current.revision,current.expression]);
      const last=await client.query<{max_revision:number}>(`SELECT COALESCE(MAX(revision),0)::integer AS max_revision
        FROM md_field_default_formula_history WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3`,
        [a.tenant_id,req.params.objectApi,field]);
      const next=current?current.revision+1:Number(last.rows[0]?.max_revision??0)+1;
      await client.query(`INSERT INTO md_field_default_formulas(tenant_id,object_api,field_api,expression,revision)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,object_api,field_api)
        DO UPDATE SET expression=EXCLUDED.expression,revision=EXCLUDED.revision`,
        [a.tenant_id,req.params.objectApi,field,expression,next]);
      return next;
    });
    res.json({saved:true,revision});
  }));
  app.get(base+'/default-formulas/:fieldApi/history',route(async(req,res)=>{
    const a=await requireManage(req);
    if(!api.test(req.params.fieldApi))throw new Error('Invalid field API name');
    const {rows}=await db.query(`SELECT revision,expression,saved_at AS "savedAt"
      FROM md_field_default_formula_history
      WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 ORDER BY revision DESC`,
      [a.tenant_id,req.params.objectApi,req.params.fieldApi]);
    res.json({history:rows});
  }));
  app.delete(base+'/default-formulas/:fieldApi',route(async(req,res)=>{
    const a=await requireManage(req);
    if(!api.test(req.params.fieldApi))throw new Error('Invalid field API name');
    const match=req.get('if-match');
    const expected=match&&/^"[0-9]+"$/.test(match)?Number(match.slice(1,-1)):NaN;
    if(!Number.isSafeInteger(expected)||expected<1)throw new Error('Invalid rule revision precondition');
    await db.transaction(async client=>{
      const {rows}=await client.query<{revision:number;expression:string}>(`
        DELETE FROM md_field_default_formulas WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3
        AND revision=$4 RETURNING revision,expression`,[a.tenant_id,req.params.objectApi,req.params.fieldApi,expected]);
      if(!rows[0])throw new Error('Rule revision conflict');
      await client.query(`INSERT INTO md_field_default_formula_history
        (tenant_id,object_api,field_api,revision,expression) VALUES($1,$2,$3,$4,$5)`,
        [a.tenant_id,req.params.objectApi,req.params.fieldApi,rows[0].revision,rows[0].expression]);
    });
    res.status(204).end();
  }));
}
