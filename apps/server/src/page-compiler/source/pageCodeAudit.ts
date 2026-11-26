import {readNames} from './pageCodeNames.js';

/**
 * What in a page's code files is NOT plain code yet: actions that did not convert, formulas
 * left as text, and formula helpers the converter could not avoid. The app rebuild reports
 * it for every screen; [] means the page is fully converted.
 */
const HELPERS:ReadonlyArray<[RegExp,string]>=[
 [/\bO\.b\(/g,'formula operator helper O.b()'],
 [/\bO\.t\(/g,'formula truth helper O.t()'],
 [/\bO\.s\(/g,'text join helper O.s()'],
 [/\bO\.u\(/g,'formula sign helper O.u()'],
 [/\bO\.out\(/g,'number check helper O.out()'],
 [/\bO\.blank\(/g,'blank check helper O.blank()'],
 [/\$\.f\(/g,'field read helper $.f()'],
 [/(^|[^A-Za-z0-9_$.])v\[/g,'variable map v[...]']
];
export function auditPageCode(files:Record<string,string>,pageApi:string):string[]{
 const out:string[]=[];
 const code=(files[pageApi+'.formulas.ts']??'')+'\n'+(files[pageApi+'.actions.ts']??'')+'\n'+(files[pageApi+'.data.ts']??'');
 for(const [pattern,label] of HELPERS){
  const count=(code.match(pattern)??[]).length;
  if(count)out.push(count+' × '+label);
 }
 // Actions with no code (they would wait for the server or not run as code).
 let group='',part='';
 for(const line of (files[pageApi+'.actions.ts']??'').split('\n')){
  let match:RegExpMatchArray|null;
  if((match=line.match(/^ {2}("[^"]+"|[A-Za-z_$][\w$-]*): \{$/)))group=match[1].replace(/"/g,'');
  else if((match=line.match(/^ {4}("[^"]+"|[A-Za-z_$][\w$-]*): \{$/)))part=match[1].replace(/"/g,'');
  else if(/^\s+issue: /.test(line))out.push('Action not converted: '+group+'.'+part);
 }
 // A formula left as text in the screen (a list's TABLE() data source is a setting, not a formula).
 for(const match of (files[pageApi+'.tsx']??'').matchAll(/ ([A-Za-z0-9_]+)=(?:"=|\{"=)(?!\s*TABLE\s*\()/g))
  out.push('Formula not converted: '+match[1]);
 if(files['manifest.json']&&!readNames(files['manifest.json']))out.push('Older code format: rebuild the app');
 return out;
}
