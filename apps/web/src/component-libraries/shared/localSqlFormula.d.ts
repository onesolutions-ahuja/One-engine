export class LocalSqlUnsupported extends Error {}
export function decFromString(text:string):unknown;
export function decFromNumber(value:number):unknown;
export function evaluateLocalSql(node:unknown,refs:(name:string)=>unknown):unknown;
export function substituteLocalAggregates(node:unknown,criterionValue:(node:unknown)=>unknown,
  rowsFor:(object:string,filters:{field:string;operator:'eq';value:string}[])=>Promise<Record<string,unknown>[]|null>):Promise<unknown>;
export function localSqlResultValue(value:unknown):unknown;
