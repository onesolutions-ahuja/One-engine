import type {PoolClient} from 'pg';
import type {DeclarativeRules} from './ValidationRuleEngine.js';
import type {RecordLifecycleContext} from './ValidationRuleEngine.js';
import type {RecordMatching} from './MatchingRuleEngine.js';
type Values=Record<string,unknown>;
/** Keep validation and matching in one transaction; Record Engine still owns SQL writes. */
export async function validateAndMatchRecord(rules:DeclarativeRules,matching:RecordMatching,
 client:PoolClient,tenantId:string,userId:string,objectApi:string,
 current:Values|(()=>Promise<Values>),prior:Values|null|(()=>Promise<Values|null>),excludeId?:string,
 lifecycle?:RecordLifecycleContext){
 await rules.validate(client,tenantId,userId,objectApi,current,prior,lifecycle);
 return matching.check(client,tenantId,userId,objectApi,current,excludeId);
}
