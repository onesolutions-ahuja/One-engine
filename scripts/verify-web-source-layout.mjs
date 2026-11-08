import assert from 'node:assert/strict';
import { readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { loadComponentCatalog, webSourceRoot } from './component-catalog.mjs';

const entries = await readdir(webSourceRoot, { withFileTypes: true });
assert.deepEqual(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), ['component-libraries', 'core']);
assert.deepEqual(entries.filter(entry => entry.isFile()).map(entry => entry.name).sort(), ['main.tsx']);
// A renamed library is not enough: fail if any retired source component filename remains.
for (const relative of ['component-libraries','component-libraries/shared']) {
 const contents=await readdir(path.join(webSourceRoot,relative),{withFileTypes:true});
 const obsolete=contents.filter(entry =>
   /^One[A-Z]/.test(entry.name)||/^Une[A-Z]/.test(entry.name)||
   (entry.isDirectory()&&/^une_[a-z]/.test(entry.name)));
 assert.deepEqual(obsolete.map(entry=>entry.name),[],
   'No retired One/UNE renderer filenames may remain in '+relative);
}
const { components } = await loadComponentCatalog();
const publishedOne=components.filter(component=>component.apiName.startsWith('One'));
assert.deepEqual(publishedOne,[], 'No legacy One components may be independently registered');
const registered=components.filter(component=>component.apiName.startsWith('ui_'));
assert.equal(registered.length,0,'Retired ui_* component descriptors must not be registered');
const oldUiPackages=(await readdir(path.join(webSourceRoot,'component-libraries'),{withFileTypes:true}))
  .filter(entry=>entry.isDirectory()&&entry.name.startsWith('ui_'));
assert.deepEqual(oldUiPackages.map(entry=>entry.name),[], 'Retired UI component packages must not remain');
for (const name of ['Text.jsx','Search.jsx','SharedButton.jsx']) {
 await assert.rejects(access(path.join(webSourceRoot,'core/components/SharedRuntime',name)),{code:'ENOENT'});
}
for (const name of ['Actions.jsx','Inputs.jsx','Display.jsx','Layout.jsx','Data.jsx','CardCore.jsx']) {
 await assert.rejects(access(path.join(webSourceRoot,'component-libraries/shared',name)),{code:'ENOENT'});
}
console.log(`Web layout verified: Smart components only; retired One/UNE runtime modules are absent.`);
