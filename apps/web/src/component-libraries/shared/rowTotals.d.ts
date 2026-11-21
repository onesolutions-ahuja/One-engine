export function hasRowTotals(formula:unknown):boolean;
export function withRowTotals(formula:unknown,rows:unknown,compileNode:(node:unknown)=>(row:Record<string,unknown>)=>unknown):((row:Record<string,unknown>)=>unknown)|null;
