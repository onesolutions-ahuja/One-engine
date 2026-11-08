export class FlowCustomError extends Error {
 constructor(message:string,readonly fieldName?:string){
  super(message);
  this.name='FlowCustomError';
 }
}

export function createFlowCustomError(config:Record<string,unknown>,
 resolve:(reference:string)=>unknown):FlowCustomError {
 const template=config.errorMessage;
 if(typeof template!=='string'||!template.trim()||template.length>1000)
  throw new Error('Custom Error requires a message of at most 1000 characters');
 const message=template.replace(/\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/g,(_match,reference:string)=>{
  const value=resolve(reference);
  if(value!==null&&value!==undefined
    &&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')
   throw new Error('Custom Error message references a non-scalar resource');
  return value===null||value===undefined?'':String(value);
 });
 if(!message.trim()||message.length>1000)
  throw new Error('Custom Error message is empty or exceeds 1000 characters');
 const location=config.errorLocation??'Page';
 if(location!=='Page'&&location!=='Field')
  throw new Error('Custom Error location must be Page or Field');
 let fieldName:string|undefined;
 if(location==='Field'){
  if(typeof config.fieldName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(config.fieldName))
   throw new Error('Custom Error field is invalid');
  fieldName=config.fieldName;
 }
 return new FlowCustomError(message,fieldName);
}
