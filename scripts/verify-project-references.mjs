import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignore = new Set(['.git', 'node_modules', 'dist', 'dist-system', 'coverage', '.artifacts', '.cache']);
const sourcePattern = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const textPattern = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|ya?ml|md)$/;
const extensions = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.d.mts', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(item.name)) continue;
    const location = path.join(dir, item.name);
    if (item.isDirectory()) walk(location);
    else if (item.isFile() && textPattern.test(item.name)) files.push(location);
  }
}
walk(root);
const missing = [];
const consolidatedArchives=[
  'apps/server/test/system/backend.test.mjs',
  'apps/web/test/frontend.test.mjs',
  'scripts/scripts.test.mjs'
];
const virtualTests=new Set();
const archivedSources=new Map();
for(const archive of consolidatedArchives){
  if(!fs.existsSync(archive))continue;
  const contents=fs.readFileSync(archive,'utf8');
  const start=contents.indexOf('const SOURCES=');
  const finish=start>=0?contents.indexOf(';\n',start):-1;
  if(finish<0)throw new Error('Invalid consolidated test archive: '+archive);
  const entries=JSON.parse(contents.slice(start+'const SOURCES='.length,finish));
  archivedSources.set(archive,entries);
  for(const [original] of entries)virtualTests.add(path.resolve(root,original));
}
function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return;
  const base = path.resolve(path.dirname(from), specifier);
  const noJs = base.replace(/\.(?:js|mjs|cjs)$/, '');
  const choices = new Set([base, ...extensions.map(x => base + x), ...extensions.map(x => noJs + x)]);
  if ([...choices].some(location=>fs.existsSync(location)||virtualTests.has(location))) return;
  // Source audits run before TypeScript compilation. Resolve references to generated
  // dist-system JS against their actual source modules, without waiving existence checks.
  const outputRoot = path.join(root, 'apps/server/dist-system');
  const relative = path.relative(outputRoot, base);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    const source = path.join(root, 'apps/server/src', relative).replace(/\.(?:js|mjs|cjs)$/, '');
    if (['.ts', '.tsx', '.mts', '.cts'].some(extension => fs.existsSync(source + extension))) return;
  }
  missing.push({ file: path.relative(root, from), target: specifier, type: 'module' });
}
const importPattern = /(?:\b(?:import|export)\s+(?:[\s\S]{0,160}?\s+from\s*)?['"]([^'"]+)['"]|\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\))/g;
const fileExec = /\b(?:node|tsx|bash|sh)\s+(?:--[\w-]+\s+)*((?:\.\/|\.\.\/|scripts\/|apps\/|tests\/)[\w./-]+\.(?:mjs|js|ts|sh))\b/g;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const relativeFile=path.relative(root,file).replaceAll(path.sep,'/');
  if(archivedSources.has(relativeFile)){
    for(const [original,source] of archivedSources.get(relativeFile)){
      const sourcePath=path.resolve(root,original);
      for(const match of source.matchAll(importPattern))resolveImport(sourcePath,match[1]||match[2]);
    }
  }else if (sourcePattern.test(file)) {
    for (const match of content.matchAll(importPattern)) resolveImport(file, match[1] || match[2]);
  }
  if (/\.ya?ml$/.test(file) || path.basename(file) === 'package.json') {
    for (const match of content.matchAll(fileExec)) {
      const target = match[1];
      const locations = [path.resolve(root, target), path.resolve(path.dirname(file), target)];
      if (!locations.some(fs.existsSync)) missing.push({ file: path.relative(root, file), target, type: 'command' });
    }
  }
}
const unique = [...new Map(missing.map(x => [JSON.stringify(x), x])).values()];
console.log(JSON.stringify({ scanned: files.length, missing: unique }, null, 2));
if (unique.length) process.exitCode = 1;
