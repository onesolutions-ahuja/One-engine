import {LEGACY_REFERENCE} from './PageReferences.js';
export type Token={kind:'number'|'string'|'identifier'|'reference'|'operator'|'punctuation';value:string};
const LEGACY_ERROR='Old $ references are no longer used. Type @ and pick from ThisPage, ThisTenant or an Object.';
/** Page action / page formulas are compiled to code, so they get a larger budget than SQL, flow and validation formulas. */
export const PAGE_FORMULA_LIMITS={tokens:1024,characters:8000} as const;
export const DEFAULT_FORMULA_LIMITS={tokens:512,characters:4000} as const;
export type FormulaLimits={tokens:number;characters:number};
export function tokenize(source:string,limits:FormulaLimits=DEFAULT_FORMULA_LIMITS):Token[] {
  if(source.length>limits.characters)throw new Error(`Formula exceeds the ${limits.characters}-character limit`);
  const tooMany=()=>new Error(`Formula exceeds the ${limits.tokens}-token complexity limit`);
  const tokens:Token[]=[];
  let index=0;
  while(index<source.length){
    const char=source[index];
    if(/\s/.test(char)){index++;continue;}
    if(char==='"'||char==="'"){
      const quote=char;
      index++;
      let value='';
      let closed=false;
      while(index<source.length){
        if(source[index]==='\\'&&index+1<source.length){value+=source[index+1];index+=2;continue;}
        if(source[index]===quote){
          if(source[index+1]===quote){value+=quote;index+=2;continue;}
          index++;closed=true;break;
        }
        value+=source[index++];
      }
      if(!closed)throw new Error('Unterminated Flow formula string');
      tokens.push({kind:'string',value});
      if(tokens.length>limits.tokens)throw tooMany();
      continue;
    }
    const reference=/^\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/.exec(source.slice(index));
    if(reference){tokens.push({kind:'reference',value:reference[1]});index+=reference[0].length;
      if(tokens.length>limits.tokens)throw tooMany();
      continue;}
    const shorthand=/^@([A-Za-z_$][A-Za-z0-9_$.]*)/.exec(source.slice(index));
    if(shorthand&&LEGACY_REFERENCE.test('@'+shorthand[1]))throw new Error(LEGACY_ERROR);
    if(shorthand){tokens.push({kind:'reference',value:shorthand[1]});index+=shorthand[0].length;
      if(tokens.length>limits.tokens)throw tooMany();
      continue;}
    const number=/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/.exec(source.slice(index));
    if(number){tokens.push({kind:'number',value:number[0]});index+=number[0].length;
      if(tokens.length>limits.tokens)throw tooMany();
      continue;}
    const identifier=/^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(source.slice(index));
    if(identifier){
      const value=identifier[0];
      if(value.startsWith('$')&&LEGACY_REFERENCE.test(value))throw new Error(LEGACY_ERROR);
      const functionCall=/^(AND|OR|NOT)$/i.test(value)
        &&/^\s*\(/.test(source.slice(index+value.length));
      tokens.push({kind:/^(AND|OR|NOT)$/i.test(value)&&!functionCall?'operator':'identifier',value});
      index+=value.length;
      if(tokens.length>limits.tokens)throw tooMany();
      continue;
    }
    const operator=/^(?:>=|<=|<>|!=|==|[+\-*/%^&=<>])/.exec(source.slice(index));
    if(operator){tokens.push({kind:'operator',value:operator[0]});index+=operator[0].length;
      if(tokens.length>limits.tokens)throw tooMany();
      continue;}
    if('(),'.includes(char)){tokens.push({kind:'punctuation',value:char});index++;
      if(tokens.length>limits.tokens)throw tooMany();
      continue;}
    throw new Error('Unsupported Flow formula character: '+char);
  }
  return tokens;
}
