export function setSqlFormulaRequest<T>(request:((path:string,init?:RequestInit)=>Promise<T>)|null):void;
export function getSqlFormulaRequest():((path:string,init?:RequestInit)=>Promise<unknown>)|null;
