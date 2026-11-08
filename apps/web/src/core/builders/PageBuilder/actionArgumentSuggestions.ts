import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';

type Choice={apiName:string;label:string};
type Source=Choice&{fields:readonly Choice[]};

/** Inspect complete tokens before the caret, including nested call frames. */
export function actionArgumentSuggestions(before:string,objects:readonly Source[],flows:readonly Choice[],
 pages:readonly (Choice&{pageType:string;status:string})[]=[],credentials:readonly Choice[]=[]){
 const suffix=/[A-Za-z0-9_.]*$/.exec(before)?.[0]??'';
 const prefix=before.slice(0,before.length-suffix.length);
 let tokens;
 try{tokens=tokenize(prefix);}catch{return null;}
 const stack:Array<{name:string;args:string[][]}>=[];
 const aliases=new Map<string,string>();
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i],frame=stack.at(-1);
  if(token.kind==='punctuation'&&token.value==='('){
   stack.push({name:tokens[i-1]?.value.toUpperCase()??'',args:[[]]});
  }else if(token.kind==='punctuation'&&token.value===')'){
   stack.pop();
   const parent=stack.at(-1);
   if(frame?.name==='AS'&&parent&&['CREATERECORD','UPDATERECORD','CREATEPDF'].includes(parent.name))
    aliases.set(frame.args[0].join(''),parent.name==='CREATEPDF'?'__PDF__':parent.args[0].join(''));
  }else if(token.kind==='punctuation'&&token.value===',')frame?.args.push([]);
  else frame?.args.at(-1)?.push(token.value);
 }
 const frame=stack.at(-1);
 if(!frame||frame.args.at(-1)?.length)return null;
 const index=frame.args.length-1;
 const [alias,field]=suffix.split('.');
 if(field!==undefined){
  if(aliases.get(alias)==='__PDF__')return {query:suffix,choices:[{apiName:alias+'.FileId',label:'Generated PDF file ID'}]};
  const source=objects.find(object=>object.apiName===aliases.get(alias));
  return source?{query:suffix,choices:source.fields.map(item=>({...item,apiName:alias+'.'+item.apiName}))}:null;
 }
 if(index===0&&['SCREEN','PRINT','CREATEPDF'].includes(frame.name))
  return {query:suffix,choices:pages.filter(item=>item.status==='Active'&&(['PRINT','CREATEPDF'].includes(frame.name)
   ?item.pageType==='Print Template':['App Page','In-Screen Page'].includes(item.pageType)))};
 if(index===1&&frame.name==='SCREEN')return {query:suffix,choices:['current','popup','newwindow'].map(apiName=>({apiName,label:apiName}))};
 if(index===0&&['EMAIL','WHATSAPP','SMS'].includes(frame.name))return {query:suffix,choices:credentials};
 if(frame.name==='FLOW'&&index===0)return {query:suffix,choices:flows};
 if(!['CREATERECORD','UPDATERECORD','DELETERECORD'].includes(frame.name))return null;
 if(index===0)return {query:suffix,choices:objects};
 const start=frame.name==='CREATERECORD'?1:2;
 if(frame.name!=='DELETERECORD'&&index>=start&&(index-start)%2===0)
  return {query:suffix,choices:objects.find(item=>item.apiName===frame.args[0].join(''))?.fields??[]};
 return null;
}
