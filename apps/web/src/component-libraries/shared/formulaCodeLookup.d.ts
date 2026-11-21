export function formulaShape(text:unknown):string|null;
export function convertedFormula(functions:unknown,text:unknown):((row:Record<string,unknown>)=>unknown)|null;
export function componentFormula(p:unknown,text:unknown):((row:Record<string,unknown>)=>unknown)|null;
export function runComponentFormula(p:unknown,text:unknown,row?:unknown):{value:unknown;error?:string};
export function formulaConverter(p:unknown):{compile:(text:unknown)=>((row:Record<string,unknown>)=>unknown)|null;compileNode:(node:unknown)=>(row:Record<string,unknown>)=>unknown}|null;
