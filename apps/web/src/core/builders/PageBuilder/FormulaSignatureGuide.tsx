import {formulaSignatureAt} from './formulaSignatureHelp';

/** Shared, registry-backed Excel-like guide for multiline and single-line formula editors. */
export default function FormulaSignatureGuide({value,caret}:{value:string;caret:number}){
 const active=formulaSignatureAt(value,caret);
 if(!active)return null;
 const count=Math.min(active.maximumArguments,Math.max(active.minimumArguments,active.argument+2,4));
 return <div role="status" aria-label="Formula argument help"
  style={{fontSize:12,lineHeight:1.5,fontFamily:'Consolas,monospace',padding:'6px 9px',
   border:'1px solid #aac1dc',borderRadius:5,background:'#f7faff',color:'#263d59',
   maxWidth:'100%',overflowWrap:'anywhere'}}>
  <strong>{active.name}</strong> (
  {active.parameters.slice(0,count).map((parameter,index)=>
   <span key={index} style={{fontWeight:index===active.argument?800:400,
    background:index===active.argument?'#dcecff':'transparent'}}>
    {index?', ':''}{parameter.name}{parameter.optional?'?':''}
   </span>)}
  {count<active.maximumArguments?', …':''})
 </div>;
}
