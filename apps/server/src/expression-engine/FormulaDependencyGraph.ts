import {Parser,type Expression} from './FormulaParser.js';
import {tokenize} from './FormulaTokenizer.js';

export function flowFormulaReferences(expression:string):string[] {
  const found=new Set<string>();
  const visit=(node:Expression):void=>{
    if(node.kind==='reference')found.add(node.value);
    else if(node.kind==='unary')visit(node.value);
    else if(node.kind==='binary'){visit(node.left);visit(node.right);}
    else if(node.kind==='call')node.args.forEach(visit);
  };
  visit(new Parser(tokenize(expression)).parse());
  return [...found];
}
