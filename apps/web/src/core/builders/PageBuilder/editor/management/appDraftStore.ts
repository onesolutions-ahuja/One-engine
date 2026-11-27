import type { LightningPageMetadata, PageLayoutVariant } from '../../../../metadata/Definitions/metadata';

/**
 * Unsaved edits of an app's pages while Page Builder edits the whole app (opened from App Manager).
 * Switching pages keeps the page's edits here instead of asking to discard them; Save / Publish
 * write every kept page together. Page Builder remounts per page, so this lives outside React.
 */
export type AppDraft = { page: LightningPageMetadata; saved: LightningPageMetadata };

const drafts = new Map<string, Map<string, AppDraft>>();
const key = (apiName: string, variant: PageLayoutVariant) => apiName + '/' + variant;

export const keepAppDraft = (appId: string, page: LightningPageMetadata, saved: LightningPageMetadata) => {
  const app = drafts.get(appId) ?? new Map<string, AppDraft>();
  app.set(key(page.apiName, page.layoutVariant ?? 'Desktop'), { page, saved });
  drafts.set(appId, app);
};

export const appDraftFor = (appId: string, apiName: string, variant: PageLayoutVariant): AppDraft | undefined =>
  drafts.get(appId)?.get(key(apiName, variant));

export const dropAppDraft = (appId: string, apiName: string, variant: PageLayoutVariant) => {
  drafts.get(appId)?.delete(key(apiName, variant));
};

/** Every kept page of the app except the one open in the editor. */
export const otherAppDrafts = (appId: string, open?: { apiName: string; variant: PageLayoutVariant }): AppDraft[] =>
  [...(drafts.get(appId)?.entries() ?? [])]
    .filter(([id]) => !open || id !== key(open.apiName, open.variant))
    .map(([, draft]) => draft);

export const hasAppDrafts = (appId: string) => Boolean(drafts.get(appId)?.size);
