export type FlowDecisionCondition = {
  field?: unknown;
  value?: unknown;
  operator?: unknown;
  priorValue?: unknown;
};

type DecisionResolver = (value: unknown) => unknown;
type WasSetResolver = (value: unknown) => boolean;

function compare(condition: FlowDecisionCondition, resolve: DecisionResolver,
  wasSet: WasSetResolver): boolean {
  const operator = String(condition.operator ?? 'Equals').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const pair = () => ({actual: resolve(condition.field), expected: resolve(condition.value)});
  switch (operator) {
    case 'equals':
    case 'equal': {
      const {actual, expected} = pair();
      return actual === expected;
    }
    case 'notequals':
    case 'notequal': {
      const {actual, expected} = pair();
      return actual !== expected;
    }
    case 'greater':
    case 'greaterthan': {
      const {actual, expected} = pair();
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    }
    case 'greaterthanorequalto':
    case 'greaterthanorequal': {
      const {actual, expected} = pair();
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    }
    case 'less':
    case 'lessthan': {
      const {actual, expected} = pair();
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    }
    case 'lessthanorequalto':
    case 'lessthanorequal': {
      const {actual, expected} = pair();
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    }
    case 'isnull':
      return resolve(condition.field) === null || resolve(condition.field) === undefined
        || resolve(condition.field) === '';
    case 'isnotnull':
      return resolve(condition.field) !== null && resolve(condition.field) !== undefined
        && resolve(condition.field) !== '';
    case 'contains': {
      const {actual, expected} = pair();
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    }
    case 'startswith': {
      const {actual, expected} = pair();
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    }
    case 'endswith': {
      const {actual, expected} = pair();
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    }
    case 'doesnotcontain':case 'notcontains': {
      const {actual, expected} = pair();
      return typeof actual === 'string' && typeof expected === 'string' && !actual.includes(expected);
    }
    case 'wasset': {
      if (Object.hasOwn(condition, 'priorValue')) {
        const {actual, expected: prior} = {
          actual: resolve(condition.field),
          expected: resolve(condition.priorValue)
        };
        const wasBlank = (value: unknown) => value === null || value === undefined || value === '';
        return !wasBlank(prior) ? false : !wasBlank(actual);
      }
      return wasSet(condition.field);
    }
    case 'isset':
      return wasSet(condition.field);
    case 'ischanged':
      if (!Object.hasOwn(condition, 'priorValue') && !Object.hasOwn(condition, 'value'))
        throw new Error('Is Changed requires a prior value');
      return resolve(condition.field) !== resolve(
        Object.hasOwn(condition, 'priorValue') ? condition.priorValue : condition.value);
    default:
      throw new Error('Unsupported Decision operator: ' + String(condition.operator));
  }
}

function evaluateCustomLogic(logic: string, values: readonly boolean[]): boolean {
  const tokens = logic.match(/\d+|AND|OR|\(|\)/gi);
  if (!tokens || tokens.join('').replace(/AND|OR/gi, '').length === 0)
    throw new Error('Invalid custom Decision logic');
  const compact = logic.replace(/\s+/g, '');
  if (tokens.join('').toLowerCase() !== compact.toLowerCase())
    throw new Error('Invalid custom Decision logic');
  let position = 0;
  const parseAtom = (): boolean => {
    const token = tokens[position++];
    if (token === '(') {
      const value = parseOr();
      if (tokens[position++] !== ')') throw new Error('Invalid custom Decision logic');
      return value;
    }
    if (!token || !/^\d+$/.test(token)) throw new Error('Invalid custom Decision logic');
    const index = Number(token) - 1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= values.length)
      throw new Error('Custom Decision logic references an unknown condition');
    return values[index];
  };
  const parseAnd = (): boolean => {
    let value = parseAtom();
    while (tokens[position]?.toUpperCase() === 'AND') {
      position++;
      const right = parseAtom();
      value = value && right;
    }
    return value;
  };
  const parseOr = (): boolean => {
    let value = parseAnd();
    while (tokens[position]?.toUpperCase() === 'OR') {
      position++;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };
  const result = parseOr();
  if (position !== tokens.length) throw new Error('Invalid custom Decision logic');
  return result;
}

export function evaluateFlowDecisionOutcome(
  conditions: readonly FlowDecisionCondition[],
  conditionLogic: string | undefined,
  resolve: DecisionResolver,
  wasSet: WasSetResolver = value => resolve(value) !== undefined
): boolean {
  if (conditions.length === 0) return false;
  const results = conditions.map(condition => compare(condition, resolve, wasSet));
  const logic = conditionLogic?.trim();
  if (conditionLogic === undefined || logic === 'All') return results.every(Boolean);
  if (logic === 'Any') return results.some(Boolean);
  if (!logic) throw new Error('Invalid custom Decision logic');
  return evaluateCustomLogic(logic, results);
}

export function evaluateFlowDecisionComparison(actual: unknown, expected: unknown,
  operator: unknown): boolean {
  return compare({ field: actual, value: expected, operator }, value => value, () => false);
}

/** Resolve the selected outcome of a Decision node, including record-trigger prior-value conditions. */
export function executeDecisionNode(input:{
 node:{id:number;config:Record<string,unknown>};flowType:string;
 vars:Record<string,unknown>;evaluate:(value:unknown)=>unknown;
}):string{
 const {node,flowType,vars,evaluate}=input;
          const outcomes=Array.isArray(node.config.outcomes)?node.config.outcomes as Array<Record<string,unknown>>:[];
          const matches=(o:Record<string,unknown>)=>{
            if(!Array.isArray(o.conditions)||!o.conditions.length)return false;
            const conditions=(o.conditions as Array<Record<string,unknown>>).map(condition=>{
              const currentField=typeof condition.field==='string'
                ?/^\{!\$Record\.([A-Za-z][A-Za-z0-9_]*)\}$/.exec(condition.field)?.[1]:undefined;
              const triggerOperator=['ischanged','wasset'].includes(
                String(condition.operator??'').trim().toLowerCase().replace(/[\s_-]+/g,''));
              return flowType==='Record-Triggered Flow'&&triggerOperator&&currentField
                &&!Object.hasOwn(condition,'priorValue')
                ?{...condition,priorValue:`{!$Record__Prior.${currentField}}`}:condition;
            });
            return evaluateFlowDecisionOutcome(
              conditions,
              typeof o.conditionLogic==='string'?o.conditionLogic:undefined,
              evaluate,
              value=>{
                if(typeof value!=='string')return value!==undefined;
                const reference=value.match(/^\{!([A-Za-z_$][A-Za-z0-9_$.]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?\}$/)
                  ??value.match(/^@([A-Za-z_$][A-Za-z0-9_$.]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/);
                if(!reference)return true;
                if(!Object.hasOwn(vars,reference[1]))return false;
                if(!reference[2])return true;
                const base=vars[reference[1]];
                return Boolean(base&&typeof base==='object'&&!Array.isArray(base)
                  &&Object.hasOwn(base,reference[2]));
              });
          };
          const selectedOutcome=outcomes.find(o=>o.name!=='Default'&&matches(o));
          return String(selectedOutcome?.label??selectedOutcome?.name??'Default');
}
