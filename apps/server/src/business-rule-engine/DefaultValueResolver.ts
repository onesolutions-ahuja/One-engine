import type {PoolClient} from 'pg';
import {evaluateResolvedFormulaSql} from '../system-support/formula-sql-runtime.js';
import {
  evaluateFlowFormula,flowFormulaReferences,type FormulaEvaluationContext
} from '../system-files/flow-formula-runtime.js';
type Values=Record<string,unknown>;
type FormulaContext={
  resolve:(name:string)=>unknown;
  timeZone:string;
  evaluation:FormulaEvaluationContext
};
/** Resolve tenant SQL formula defaults, including dependency cycles, through the shared formula runtime. */
export async function resolveDefaultValues(client:PoolClient,tenantId:string,userId:string,objectApi:string,values:Values,
    literals:Values,context:(expression:string,values:Values,now:Date|string)=>Promise<FormulaContext>,
    evaluationNow?:Date|string) {
    const {rows}=await client.query<{field_api:string;expression:string}>(
      `SELECT d.field_api,d.expression FROM md_field_default_formulas d
       JOIN md_field_definitions f ON f.tenant_id=d.tenant_id AND f.object_api=d.object_api
        AND f.api_name=d.field_api AND f.deleted_at IS NULL
       WHERE d.tenant_id=$1 AND d.object_api=$2 ORDER BY d.field_api`,[tenantId,objectApi]);
    const pending=new Map(rows.filter(row=>values[row.field_api]===undefined)
      .map(row=>[row.field_api,row.expression]));
    const now=evaluationNow??new Date();
    for(const [field,value] of Object.entries(literals))
      if(values[field]===undefined&&!pending.has(field))values[field]=value;
    const visiting=new Set<string>();
    const resolveDefault=async (field:string):Promise<void>=>{
      if(!pending.has(field))return;
      if(visiting.has(field))throw new Error('Cyclic formula default: '+field);
      visiting.add(field);
      const expression=pending.get(field)!;
      for(const ref of flowFormulaReferences(expression)){
        const name=ref.startsWith('$Record.')?ref.slice(8):
          ref.startsWith(objectApi+'.')?ref.slice(objectApi.length+1):ref;
        if(pending.has(name))await resolveDefault(name);
      }
      const ctx=await context(expression,values,now);
      const result=await evaluateResolvedFormulaSql(client,expression,ctx.resolve,
        {...ctx.evaluation,timeZone:ctx.timeZone,now},'formula_field');
      if(result!==undefined){
        if(result!==null&&typeof result!=='string'&&typeof result!=='number'&&typeof result!=='boolean')
          throw new Error('Invalid formula default result: '+field);
        values[field]=result;
      }
      pending.delete(field);
      visiting.delete(field);
    };
    for(const field of [...pending.keys()])await resolveDefault(field);
    return values;
  }
