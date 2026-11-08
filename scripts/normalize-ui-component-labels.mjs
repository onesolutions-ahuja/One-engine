import { readdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
const root='apps/web/src/component-libraries';
let changed=0;
for(const directory of await readdir(root,{withFileTypes:true})){
 if(!directory.isDirectory()||!/^ui_[a-z][a-z0-9_]*$/.test(directory.name))continue;
 const source=path.join(root,directory.name,'component.json');
 const original=await readFile(source,'utf8');
 const descriptor=JSON.parse(original);
 if(descriptor.apiName!==directory.name)throw Error('Wrong component API name: '+source);
 if(typeof descriptor.label==='string'&&descriptor.label.startsWith('UNE ')){
   descriptor.label='UI '+descriptor.label.slice(4);
   await writeFile(source,JSON.stringify(descriptor,null,2)+'\n');
   changed++;
 }
}
console.log('Normalised '+changed+' remaining public component labels');
