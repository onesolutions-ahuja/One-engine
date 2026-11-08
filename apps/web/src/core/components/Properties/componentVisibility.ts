import { compareMetadataValue } from '../../metadata/Definitions/metadataValueComparison';
import type { FieldMetadata, PageComponentMetadata } from '../../metadata/Definitions/metadata';
import { examineRecordFilter } from '../../records/RecordWorkspace/recordFilterMetadata';

export type VisibilityCondition =
  | { source: 'Device'; operator: 'Equals' | 'Not Equals'; value: 'Desktop' | 'Tablet' | 'Phone' }
  | { source: 'Record Field'; fieldApiName: string; operator: string; value: string }
  | { source: 'Record Type' | 'User Profile'; operator: 'Equals' | 'Not Equals'; value: string }
  | { source: 'Record Permission'; operator: 'Equals' | 'Not Equals'; value: 'Create' | 'Edit' | 'Delete' };

export type ComponentVisibilityRule = {
  logic: 'All' | 'Any';
  conditions: VisibilityCondition[];
  /** Optional one-based condition expression, e.g. 1 AND (2 OR 3). */
  expression?: string;
};

export type ComponentVisibilityContext = {
  formFactor: 'Desktop' | 'Tablet' | 'Phone';
  fields?: ReadonlyArray<FieldMetadata>;
  record?: Readonly<Record<string, unknown>> | null;
  readableFieldApiNames?: ReadonlySet<string>;
  profileId?: string;
  recordPermissions?: ReadonlySet<'Create'|'Edit'|'Delete'>;
};

const safeName = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Bounded boolean expression parser. Numbers reference one-based condition rows.
 * No eval, functions, property traversal or arbitrary executable syntax.
 */
export function evaluateConditionExpression(expression:string,results:readonly boolean[]):boolean|null{
  if(expression.length>160)return null;
  const compact=expression.replace(/\s+/g,'').toUpperCase();
  if(!compact)return null;
  const tokens=compact.match(/\d+|AND|OR|\(|\)/g)??[];
  if(tokens.join('')!==compact||tokens.length>100)return null;
  let at=0;
  const primary=():boolean=>{
    const token=tokens[at++];
    if(token==='('){
      const value=or();
      if(tokens[at++]!==')')throw Error('Unclosed group');
      return value;
    }
    if(!token||!/^\d+$/.test(token))throw Error('Expected condition reference');
    const index=Number(token);
    if(!Number.isSafeInteger(index)||index<1||index>results.length)throw Error('Invalid condition reference');
    return results[index-1];
  };
  const and=():boolean=>{
    let value=primary();
    while(tokens[at]==='AND'){at++;const right=primary();value=value&&right;}
    return value;
  };
  const or=():boolean=>{
    let value=and();
    while(tokens[at]==='OR'){at++;const right=and();value=value||right;}
    return value;
  };
  try{
    const value=or();
    return at===tokens.length?value:null;
  }catch{return null;}
}

/** Visibility controls presentation, NEVER the server's object/record/field permissions. */
export function validateVisibilityRule(
  raw: unknown,
  fields: ReadonlyArray<FieldMetadata>,
  allowRecordFields: boolean
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['Invalid visibility metadata.'];
  const rule = raw as Record<string, unknown>;
  if (rule.logic !== 'All' && rule.logic !== 'Any') return ['Choose All or Any conditions.'];
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0 || rule.conditions.length > 20) {
    return ['Add between 1 and 20 visibility conditions.'];
  }
  if(rule.expression!==undefined&&
    (typeof rule.expression!=='string'||
      evaluateConditionExpression(rule.expression,rule.conditions.map(()=>true))===null))
    return ['Invalid condition expression. Use numbered conditions with AND, OR and parentheses.'];
  return rule.conditions.flatMap((item: unknown, index: number) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return ['Condition ' + (index + 1) + ' is invalid.'];
    }
    const entry = item as Record<string, unknown>;
    if (entry.source === 'Device') {
      return (entry.operator === 'Equals' || entry.operator === 'Not Equals')
        && (entry.value === 'Desktop' || entry.value === 'Tablet' || entry.value === 'Phone')
        ? [] : ['Condition ' + (index + 1) + ' has an invalid device comparison.'];
    }
    if(entry.source==='Record Permission'){
      if(!allowRecordFields)return ['Record permission conditions require a Record Page.'];
      return (entry.operator==='Equals'||entry.operator==='Not Equals')
        &&(entry.value==='Create'||entry.value==='Edit'||entry.value==='Delete')
        ?[]:['Condition '+(index+1)+' needs a record permission.'];
    }
    if(entry.source==='Record Type'||entry.source==='User Profile'){
      if(entry.source==='Record Type'&&!allowRecordFields)return ['Record type conditions require a Record Page.'];
      return (entry.operator==='Equals'||entry.operator==='Not Equals')
        &&typeof entry.value==='string'&&entry.value.length>0&&entry.value.length<=128
        ?[]:['Condition '+(index+1)+' needs a valid profile or record type.'];
    }
    if (entry.source === 'Record Field') {
      if (!allowRecordFields) return ['Record field conditions require a Record Page.'];
      if (typeof entry.fieldApiName !== 'string' || !safeName.test(entry.fieldApiName)) {
        return ['Condition ' + (index + 1) + ' needs a record field.'];
      }
      const match = examineRecordFilter({
        field: entry.fieldApiName, operator: entry.operator, value: entry.value
      }, fields);
      return match ? ['Condition ' + (index + 1) + ': ' + match] : [];
    }
    return ['Condition ' + (index + 1) + ' has an unsupported source.'];
  });
}

/** Unconfigured components remain visible; invalid configurations fail closed. */
export function isComponentVisible(
  component: Pick<PageComponentMetadata, 'visible' | 'properties'>,
  context: ComponentVisibilityContext,
  allowRecordFields: boolean
): boolean {
  if (!component.visible) return false;
  const rule = component.properties.visibilityRules;
  if (rule === undefined || rule === null) return true;
  const fields = context.fields ?? [];
  if (validateVisibilityRule(rule, fields, allowRecordFields).length > 0) return false;
  const definition = rule as ComponentVisibilityRule;
  // Old pages expressed tablet intent as Desktop because Tablet was not a
  // recognised Device visibility value. Retain that published behaviour until
  // a developer opts into explicit Tablet visibility in this rule.
  const hasExplicitTabletCondition = definition.conditions.some(
    condition => condition.source === 'Device' && condition.value === 'Tablet'
  );
  const results = definition.conditions.map(condition => {
    if (condition.source === 'Device') {
      const isMatch = context.formFactor === condition.value || (
        context.formFactor === 'Tablet' && condition.value === 'Desktop' && !hasExplicitTabletCondition
      );
      return condition.operator === 'Equals' ? isMatch : !isMatch;
    }
    if(condition.source==='Record Permission'){
      if(!context.recordPermissions)return false;
      const allowed=context.recordPermissions.has(condition.value);
      return condition.operator==='Equals'?allowed:!allowed;
    }
    if(condition.source==='User Profile'){
      if(!context.profileId)return false;
      const match=context.profileId===condition.value;
      return condition.operator==='Equals'?match:!match;
    }
    if(condition.source==='Record Type'){
      if(!context.record)return false;
      const match=String(context.record.RecordTypeId??'')===condition.value;
      return condition.operator==='Equals'?match:!match;
    }
    if(condition.source!=='Record Field')return false;
    if (!context.record || !context.readableFieldApiNames?.has(condition.fieldApiName)
      || !Object.prototype.hasOwnProperty.call(context.record, condition.fieldApiName)) return false;
    // Only compare fields already authorised by the caller's readable set.
    return compareMetadataValue(context.record[condition.fieldApiName], condition.operator, condition.value);
  });
  if(definition.expression!==undefined)return evaluateConditionExpression(definition.expression,results)===true;
  return definition.logic === 'All' ? results.every(Boolean) : results.some(Boolean);
}
