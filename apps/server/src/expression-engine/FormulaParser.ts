import {hasExcelWildcardCriteria,matchesExcelWildcard} from './FormulaWildcard.js';
import type {Token} from './FormulaTokenizer.js';
export type Expression=
  |{kind:'literal';value:string|number|boolean|null}
  |{kind:'reference';value:string}
  |{kind:'unary';operator:string;value:Expression}
  |{kind:'binary';operator:string;left:Expression;right:Expression}
  |{kind:'call';name:string;args:Expression[]};

const MAX_EXPRESSION_DEPTH=64;
const MAX_EXPRESSION_NODES=512;

const precedence=(operator:string):number=>{
  switch(operator.toUpperCase()){
    case 'OR':return 1;
    case 'AND':return 2;
    case '=':case '==':case '!=':case '<>':case '<':case '<=':case '>':case '>=':return 3;
    case '&':return 4;
    case '+':case '-':return 5;
    case '*':case '/':case '%':return 6;
    case '^':return 7;
    default:return -1;
  }
};

export class Parser {
  private position=0;
  private nodeCount=0;
  constructor(private readonly tokens:Token[]){}
  parse():Expression {
    if(this.tokens.length>MAX_EXPRESSION_NODES)
      throw new Error('Formula exceeds the 512-token complexity limit');
    // Excel-style leading '=' is an expression marker, not a binary operator.
    // Shared by Flow, field, validation and component formula contexts.
    if(this.tokens[0]?.kind==='operator'&&this.tokens[0].value==='=')this.position=1;
    const value=this.expression(0,0);
    if(this.position!==this.tokens.length)throw new Error('Invalid Flow formula syntax');
    return value;
  }
  private addNode<T extends Expression>(node:T):T {
    if(++this.nodeCount>MAX_EXPRESSION_NODES)
      throw new Error('Formula exceeds the 512-node complexity limit');
    return node;
  }
  private expression(minimum:number,depth:number):Expression {
    if(depth>MAX_EXPRESSION_DEPTH)
      throw new Error('Formula exceeds the 64-level nesting limit');
    let left=this.primary(depth);
    while(true){
      const token=this.tokens[this.position];
      if(token?.kind!=='operator')break;
      const level=precedence(token.value);
      if(level<minimum)break;
      this.position++;
      const right=this.expression(level+(token.value==='^'?0:1),depth+1);
      left=this.addNode({kind:'binary',operator:token.value.toUpperCase(),left,right});
    }
    return left;
  }
  private primary(depth:number):Expression {
    const token=this.tokens[this.position++];
    if(!token)throw new Error('Incomplete Flow formula');
    if(token.kind==='operator'&&(token.value==='-'||token.value==='+'||token.value.toUpperCase()==='NOT')){
      const operator=token.value.toUpperCase();
      const operandPrecedence=operator==='NOT'?3:7;
      return this.addNode({kind:'unary',operator,value:this.expression(operandPrecedence,depth+1)});
    }
    if(token.value==='('&&token.kind==='punctuation'){
      const value=this.expression(0,depth+1);
      if(this.tokens[this.position++]?.value!==')')throw new Error('Unclosed Flow formula parenthesis');
      return value;
    }
    if(token.kind==='number'){
      const value=Number(token.value);
      if(!Number.isFinite(value))throw new Error('Formula numeric literals must be finite');
      return this.addNode({kind:'literal',value});
    }
    if(token.kind==='string')return this.addNode({kind:'literal',value:token.value});
    if(token.kind==='reference')return this.addNode({kind:'reference',value:token.value});
    if(token.kind==='identifier'){
      const name=token.value.toUpperCase();
      if(this.tokens[this.position]?.value==='('){
        this.position++;
        const args:Expression[]=[];
        if(this.tokens[this.position]?.value!==')'){
          do {
            args.push(this.expression(0,depth+1));
            if(this.tokens[this.position]?.value!==',')break;
            this.position++;
          }while(true);
        }
        if(this.tokens[this.position++]?.value!==')')throw new Error('Invalid Flow formula function call');
        return this.addNode({kind:'call',name,args});
      }
      if(name==='TRUE')return this.addNode({kind:'literal',value:true});
      if(name==='FALSE')return this.addNode({kind:'literal',value:false});
      if(name==='NULL')return this.addNode({kind:'literal',value:null});
      return this.addNode({kind:'reference',value:token.value});
    }
    throw new Error('Invalid Flow formula expression');
  }
}

const finite=(value:number):number=>{
  if(!Number.isFinite(value))throw new Error('Formula result must be finite');
  return value;
};
const formulaNumber=(value:unknown):number=>{
  const result=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
  return finite(result);
};
const formulaText=(value:unknown):string=>value===null||value===undefined?'':String(value);
export const formulaTruth=(value:unknown):boolean=>value===true||value===1||value==='true';
const compareFormulaValues=(left:unknown,right:unknown):number|null=>{
  if(typeof left==='number'&&typeof right==='number'){
    finite(left);finite(right);
    return left===right?0:left<right?-1:1;
  }
  if(typeof left==='string'&&typeof right==='string')
    return left===right?0:left<right?-1:1;
  return null;
};
export function evaluateFormulaUnary(operator:string,value:unknown):unknown {
  switch(operator.toUpperCase()){
    case 'NOT':return !formulaTruth(value);
    case '+':return formulaNumber(value);
    case '-':return finite(-formulaNumber(value));
    default:throw new Error('Unsupported formula unary operator: '+operator);
  }
}
export function evaluateFormulaBinary(operator:string,left:unknown,right:unknown,wildcardCriterion=false):unknown {
 if(wildcardCriterion&&hasExcelWildcardCriteria(right)
   &&['=','==','!=','<>'].includes(operator)){
  const matched=matchesExcelWildcard(left,right);
  return operator==='='||operator==='=='?matched:!matched;
 }
  switch(operator.toUpperCase()){
    case 'AND':return formulaTruth(left)&&formulaTruth(right);
    case 'OR':return formulaTruth(left)||formulaTruth(right);
    case '&':return formulaText(left)+formulaText(right);
    case '=':case '==':return left===right;
    case '!=':case '<>':return left!==right;
    case '>':case '>=':case '<':case '<=':{
      const comparison=compareFormulaValues(left,right);
      if(comparison===null)return false;
      if(operator==='>')return comparison>0;
      if(operator==='>=')return comparison>=0;
      if(operator==='<')return comparison<0;
      return comparison<=0;
    }
    case '+':return finite(formulaNumber(left)+formulaNumber(right));
    case '-':return finite(formulaNumber(left)-formulaNumber(right));
    case '*':return finite(formulaNumber(left)*formulaNumber(right));
    case '/':{
      const divisor=formulaNumber(right);
      if(divisor===0)throw new Error('Division by zero');
      return finite(formulaNumber(left)/divisor);
    }
    case '%':{
      const divisor=formulaNumber(right);
      if(divisor===0)throw new Error('Formula modulo by zero');
      return finite(formulaNumber(left)%divisor);
    }
    case '^':return finite(formulaNumber(left)**formulaNumber(right));
    default:throw new Error('Unsupported formula binary operator: '+operator);
  }
}
