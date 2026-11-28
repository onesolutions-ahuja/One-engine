import test from 'node:test';
import assert from 'node:assert/strict';
import { childrenOf, isDescendantOf } from '../src/core/pages/TemplatePageRuntime/pageComponentLayout';
import { componentInstanceNames } from '../../server/src/system-support/page-component-names';
import { updateEditors, sameEditorsShown, coEditorsStore } from '../src/core/builders/PageBuilder/editor/management/pageCoEditing';

type C = { id: string; type: string; properties: Record<string, unknown>; parentId?: string; visible?: boolean; label?: string };
const box = (id: string, parent?: string): C => ({ id, type: 'Custom:smart_container', properties: parent ? { layoutParentId: parent } : {}, label: id });
const label = (id: string, parent?: string): C => ({ id, type: 'Custom:smart_label', properties: parent ? { layoutParentId: parent } : {}, label: id });

test('childrenOf matches a fresh scan and follows in-place edits of the same array', () => {
  const page = [box('a'), label('b', 'a'), label('c'), box('d', 'a'), label('e', 'd')] as never[];
  assert.deepEqual(childrenOf(page, null).map((c: C) => c.id), ['a', 'c']);
  assert.deepEqual(childrenOf(page, 'a').map((c: C) => c.id), ['b', 'd']);
  assert.ok(isDescendantOf(page, 'e', 'a'));
  // Callers may change the returned list without touching the cache.
  childrenOf(page, 'a').pop();
  assert.equal(childrenOf(page, 'a').length, 2);
  // An editor path replaces an item in a copied array before saving it.
  (page as C[])[2] = label('c', 'd');
  assert.deepEqual(childrenOf(page, 'd').map((c: C) => c.id), ['c', 'e']);
  assert.deepEqual(childrenOf(page, null).map((c: C) => c.id), ['a']);
});

test('a cycle still makes both items top-level', () => {
  const page = [box('x', 'y'), box('y', 'x')] as never[];
  assert.deepEqual(childrenOf(page, null).map((c: C) => c.id), ['x', 'y']);
});

test('instance names are cached but follow renames', () => {
  const page: C[] = [label('1'), label('2')];
  assert.deepEqual([...componentInstanceNames(page).values()], ['smartlabel1', 'smartlabel2']);
  page[0] = { ...page[0], properties: { navigatorName: 'Total' } };
  assert.equal(componentInstanceNames(page).get('1'), 'Total');
  componentInstanceNames(page).set('1', 'changed');
  assert.equal(componentInstanceNames(page).get('1'), 'Total');
});

test('presence heartbeat with nothing expired keeps the same list and notifies nobody', () => {
  const now = Date.now();
  const list = [{ clientId: 'a', name: 'A', selection: ['x'], seenAt: now }];
  assert.equal(updateEditors(list, null, now + 1000), list);
  assert.ok(sameEditorsShown(list, [{ ...list[0], seenAt: now + 5000 }]));
  let calls = 0;
  const stop = coEditorsStore.subscribe(() => { calls++; });
  coEditorsStore.set(list);
  calls = 0;
  coEditorsStore.update(current => updateEditors(current, { ...list[0], seenAt: now + 2000 }, now + 2000));
  assert.equal(calls, 0);
  coEditorsStore.update(current => updateEditors(current, { ...list[0], selection: ['y'], seenAt: now + 3000 }, now + 3000));
  assert.equal(calls, 1);
  stop();
  coEditorsStore.set([]);
});
