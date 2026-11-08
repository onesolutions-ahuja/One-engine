export type FlowScalar=string|number|boolean|null;

export function isFlowScalar(value:unknown):value is FlowScalar {
 return value===null||typeof value==='string'||typeof value==='boolean'
  ||typeof value==='number'&&Number.isFinite(value);
}

export function flowScalarText(value:FlowScalar):{text:string|null;type:string} {
 if(value===null)return {text:null,type:'null'};
 return {text:String(value),type:typeof value};
}

export function parseFlowScalar(text:string|null,type:string):FlowScalar {
 if(type==='null')return null;
 if(type==='boolean')return text==='true';
 if(type==='number'){
  const parsed=Number(text);
  if(!Number.isFinite(parsed))throw new Error('Invalid Flow number');
  return parsed;
 }
 if(type==='text'||type==='string')return text??'';
 throw new Error('Unsupported Flow property type');
}
