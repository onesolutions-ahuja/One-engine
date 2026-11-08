import {existsSync, readFileSync} from 'node:fs';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Cross-feature source contracts may span the entry, a hook and its view.
function readModules(builder, names) {
  const root = fileURLToPath(new URL(`../../src/core/builders/${builder}/`, import.meta.url));
  const byName = new Map();
  function collect(file) {
    if (byName.has(file)) return;
    const source = readFileSync(file, 'utf8');
    byName.set(file, source);
    for (const match of source.matchAll(/(?:from\s+|import\()['"](\.[^'"]+)['"]/g)) {
      const child = resolve(dirname(file), match[1]);
      if (!child.startsWith(resolve(root, 'editor') + '/')) continue;
      const target = [child + '.tsx', child + '.ts'].find(existsSync);
      if (target) collect(target);
    }
  }
  collect(resolve(root, builder === 'PageBuilder' ? 'pageBuilderView.tsx' : 'FlowBuilder.tsx'));
  const sources = new Map([...byName].map(([file, source]) => [basename(file).replace(/\.tsx?$/, ''), source]));
  return (names.length ? names : [...sources.keys()]).map(name => {
    if (!sources.has(name)) throw new Error(`Unknown ${builder} module: ${name}`);
    return sources.get(name);
  }).join('\n');
}

export const readPageBuilderModules = (...names) => readModules('PageBuilder', names);
export const readFlowBuilderModules = (...names) => readModules('FlowBuilder', names);
