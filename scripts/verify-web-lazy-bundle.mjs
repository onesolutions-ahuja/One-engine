// Build-artifact check: confirms that optional workspaces are not
// reachable through static imports from the public or authenticated entry.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

const dist = resolve(process.argv[2] ?? 'apps/web/dist');
const assetDir = resolve(dist, 'assets');
assert(existsSync(resolve(dist, 'index.html')), 'Build web before running this audit');
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const files = readdirSync(assetDir).filter(name => name.endsWith('.js'));
const sources = new Map(files.map(name => [name, readFileSync(resolve(assetDir, name), 'utf8')]));
const references = (text) => [...text.matchAll(/(?:import\s*(?:\([^)]*\)|[^;]*?from\s*)|\bimport\s*)["']([^"']+\.js)["']/g)]
  .map(match => basename(match[1]));
const entry = [...html.matchAll(/<script\b[^>]*src=["']([^"']+\.js)["']/g)]
  .map(match => basename(match[1]));
assert(entry.length, 'No production entrypoint script in HTML');
const eager = new Set();
const visit = name => {
  if (eager.has(name)) return;
  assert(sources.has(name), 'Missing emitted asset: ' + name);
  eager.add(name);
  // Only static import declarations / modulepreload resources are eager.
  const js = sources.get(name);
  for (const match of js.matchAll(/(?:^|[;,])\s*import\s*(?:[^('"\n;]+from\s*)?["']([^"']+\.js)["']/gm)) visit(basename(match[1]));
};
entry.forEach(visit);
for (const name of [...html.matchAll(/<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+\.js)["']/g)].map(match => basename(match[1]))) visit(name);
const publicEager = [...eager];
const authenticatedEntries = files.filter(name => /^App-[^.]+\.js$/.test(name));
assert(authenticatedEntries.length, 'Missing authenticated application chunk');
authenticatedEntries.forEach(visit);
const optional = ['FlowBuilder', 'DashboardBuilder', 'reportBuilderView', 'pageBuilderView', 'objectManagerView', 'ComponentLibrary', 'recordWorkspaceViews'];
const names = files.filter(name => optional.some(marker => name.includes(marker)));
const eagerOptional = names.filter(name => eager.has(name));
assert.equal(eagerOptional.length, 0, 'Optional runtime assets imported eagerly: ' + eagerOptional.join(', '));
const entryBytes = [...eager].reduce((sum, name) => sum + Buffer.byteLength(sources.get(name)), 0);
const report = { dist, entry, publicEagerlyLoadedJsAssets: publicEager, authenticatedEntries, eagerlyLoadedJsAssets: [...eager], eagerlyLoadedJsBytes: entryBytes, optionalChunks: names, violations: eagerOptional };
console.log(JSON.stringify(report, null, 2));
