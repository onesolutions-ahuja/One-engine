export function sharedAggregate<T>(scopeKey:string,request:unknown,key:string,objects:readonly string[],
 compute:()=>Promise<T>|T):Promise<T>;
export function noteSharedMutation(scopeKey:string|undefined,detail:unknown):void;
export function clearSharedAggregates():void;
export const localShareStats:{requests:number;hits:number};
