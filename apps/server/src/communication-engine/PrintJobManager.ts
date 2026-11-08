/** Printing uses the existing action/Flow transport; no separate queue or bypass. */
export type AuthorizedPrintExecution={tenantId:string;userId:string;allowed:boolean};
export async function runAuthorizedPrintJob<T>(context:AuthorizedPrintExecution,execute:()=>Promise<T>):Promise<T>{
 if(!context.tenantId||!context.userId||!context.allowed)throw new Error('Print action is unavailable');
 return execute();
}
