/** Excel-style text wildcard matching for every MetaDrive formula context.
 * Multiplication and text literals stay unchanged. A pattern becomes a wildcard
 * only in a field-reference equality criterion (for example @Name = "B*").
 *
 * Wildcards: * = any sequence; ? = one character; ~*, ~?, ~~ = literals.
 * Bounded dynamic programming avoids user-controlled regex backtracking.
 */
type Token={kind:'many'|'one'|'literal';value?:string};
export function parseExcelWildcardPattern(pattern:unknown):Token[]{
 if(typeof pattern!=='string')throw Error('Wildcard criterion requires text');
 const characters=Array.from(pattern);
 if(characters.length>256)throw Error('Wildcard pattern exceeds 256 characters');
 const tokens:Token[]=[];
 for(let index=0;index<characters.length;index++){
  const char=characters[index];
  if(char==='~'&&['*','?','~'].includes(characters[index+1])){
   tokens.push({kind:'literal',value:characters[++index]});
  }else if(char==='*'){
   if(tokens.at(-1)?.kind!=='many')tokens.push({kind:'many'});
  }else if(char==='?'){
   tokens.push({kind:'one'});
  }else{
   tokens.push({kind:'literal',value:char});
  }
 }
 return tokens;
}

/** Only field comparisons interpret pattern syntax; standalone strings stay literal. */
export function hasExcelWildcardCriteria(value:unknown):value is string{
 if(typeof value!=='string')return false;
 for(let i=0;i<value.length;i++){
  if(value[i]==='*'||value[i]==='?')return true;
  if(value[i]==='~'&&['*','?','~'].includes(value[i+1]))return true;
 }
 return false;
}
/** Page State, events and session values are selectors, not data fields.
 * Thus @state.categoryId = "*" tests the literal selected All ID, while
 * @Category = @state.categoryId treats a selected "*" as a criterion. */
export function isExcelWildcardDataReference(name:string):boolean{
 return !/^(?:\$?state|\$?event|\$?session)(?:\.|$)/i.test(name);
}
/** Excel wildcards match text, not numbers or blank values. Case-insensitive. */
export function matchesExcelWildcard(value:unknown,pattern:unknown):boolean{
 const tokens=parseExcelWildcardPattern(pattern);
 if(typeof value!=='string')return false;
 const original=Array.from(value);
 if(original.length>4000)throw Error('Wildcard text exceeds 4000 characters');
 if(!original.length&&tokens.some(token=>token.kind==='many'||token.kind==='one'))
  return false;
 const characters=original.map(char=>char.toLowerCase());
 let matched=new Uint8Array(characters.length+1);
 matched[0]=1;
 for(const token of tokens){
  const next=new Uint8Array(characters.length+1);
  if(token.kind==='many'){
   next[0]=matched[0];
   for(let j=1;j<next.length;j++)next[j]=matched[j]||next[j-1]?1:0;
  }else if(token.kind==='one'){
   for(let j=1;j<next.length;j++)next[j]=matched[j-1];
  }else{
   const literal=token.value?.toLowerCase();
   for(let j=1;j<next.length;j++)
    if(characters[j-1]===literal)next[j]=matched[j-1];
  }
  matched=next;
 }
 return matched[characters.length]===1;
}

/** Shared semantic translation for server-side Record API filtering. */
export function excelWildcardSqlLike(pattern:unknown):string{
 return parseExcelWildcardPattern(pattern).map(token=>{
  if(token.kind==='many')return '%';
  if(token.kind==='one')return '_';
  return (token.value??'').replace(/[\\%_]/g,'\\$&');
 }).join('');
}
