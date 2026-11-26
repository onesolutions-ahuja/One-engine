import {build,type Plugin} from 'esbuild';
import {F,O} from '../code/formulaLibrary.js';
import type {PageCode,ServerPageCode} from '../code/pageCode.js';

/**
 * A page's .actions.ts and .data.ts (and any of the page's own files they import) -> the code
 * the SERVER runs for that page: the same files the device runs. These files are written by
 * publishing, or edited by the people who run the server (the code folder on the server);
 * tenants change pages only in Page Builder.
 *
 * An action may use the record API ($.getRecord, $.create, $.update, …: access checks,
 * history and live updates included) or plain SQL with $.sql(text, params) inside the
 * action's one transaction.
 */
const SAFE_PAGE=/^[A-Za-z0-9_.-]{1,120}$/;

function filesPlugin(files:Record<string,string>):Plugin{
 const EXTENSIONS=['','.ts','.tsx','.js'];
 return {name:'une-page-files',setup(on){
  on.onResolve({filter:/^@une\/formula-library$/},()=>({path:'formula-library',namespace:'une-global'}));
  on.onLoad({filter:/.*/,namespace:'une-global'},()=>({loader:'js',contents:'module.exports = __une_formula_library;'}));
  on.onResolve({filter:/^\.\//},args=>{
   const name=args.path.slice(2);
   const found=EXTENSIONS.map(ext=>name+ext).find(candidate=>Object.prototype.hasOwnProperty.call(files,candidate));
   return found?{path:found,namespace:'page'}:{errors:[{text:'Not a file of this page: '+args.path}]};
  });
  on.onResolve({filter:/.*/},args=>({errors:[{text:'Server page code can import only the page\'s own files and @une/formula-library: '+args.path}]}));
  on.onLoad({filter:/.*/,namespace:'page'},args=>({loader:args.path.endsWith('.tsx')?'tsx':'ts',contents:files[args.path],resolveDir:'/'}));
 }};
}

/** Build and load the server copy of a page from its files. Throws when the code does not build. */
export async function serverCodeFromFiles(files:Record<string,string>,pageApi:string):Promise<{serverCode:ServerPageCode;
 actions:PageCode['actions'];codeText:string}>{
 if(!SAFE_PAGE.test(pageApi))throw new Error('Page name is not file safe: '+pageApi);
 const entry="export {actions} from './"+pageApi+".actions';\nexport {recordSets} from './"+pageApi+".data';\n";
 const result=await build({stdin:{contents:entry,sourcefile:'server-entry.ts',loader:'ts',resolveDir:'/'},
  bundle:true,write:false,format:'cjs',platform:'neutral',target:'es2022',logLevel:'silent',
  jsx:'transform',jsxFactory:'__une_h',plugins:[filesPlugin(files)]});
 const codeText=result.outputFiles[0].text;
 const module={exports:{} as Record<string,unknown>};
 // eslint-disable-next-line @typescript-eslint/no-implied-eval
 new Function('module','exports','__une_formula_library',codeText)(module,module.exports,{F,O});
 const raw=(module.exports.actions??{}) as Record<string,Record<string,unknown>>;
 const sets=Array.isArray(module.exports.recordSets)?module.exports.recordSets as ServerPageCode['recordSets']:[];
 const list=(value:unknown)=>Array.isArray(value)?value.map(String):[];
 const serverActions:ServerPageCode['actions']={};
 const actions:PageCode['actions']=[];
 for(const [key,entryValue] of Object.entries(raw)){
  if(!entryValue||typeof entryValue.run!=='function')continue;
  const action={data:entryValue.data===true,reads:list(entryValue.reads),writes:list(entryValue.writes),ui:list(entryValue.ui),
   run:entryValue.run as (scope:unknown)=>Promise<void>};
  serverActions[key]=action;
  actions.push({key,componentId:String(entryValue.component??key.split(':')[0]),event:String(entryValue.event??key.split(':').slice(1).join(':')),
   objectApiName:'',js:String(entryValue.run),data:action.data,reads:action.reads,writes:action.writes,ui:action.ui});
 }
 return {serverCode:{actions:serverActions,recordSets:sets},actions,codeText};
}
