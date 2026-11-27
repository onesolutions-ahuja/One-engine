import test from 'node:test';
import assert from 'node:assert/strict';
import { keepAppDraft, appDraftFor, otherAppDrafts, dropAppDraft, hasAppDrafts } from '../src/core/builders/PageBuilder/editor/management/appDraftStore';

test('app drafts are kept per page and layout until saved', () => {
  const page = (apiName: string, variant: 'Desktop' | 'Custom') => ({ apiName, layoutVariant: variant, label: apiName, components: [] }) as never;
  keepAppDraft('APP', page('a', 'Custom'), page('a', 'Custom'));
  keepAppDraft('APP', page('b', 'Desktop'), page('b', 'Desktop'));
  assert.ok(appDraftFor('APP', 'a', 'Custom'));
  assert.equal(appDraftFor('APP', 'a', 'Desktop'), undefined);
  assert.deepEqual(otherAppDrafts('APP', { apiName: 'a', variant: 'Custom' }).map(d => d.page.apiName), ['b']);
  dropAppDraft('APP', 'a', 'Custom'); dropAppDraft('APP', 'b', 'Desktop');
  assert.equal(hasAppDrafts('APP'), false);
});
