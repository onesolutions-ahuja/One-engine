/**
 * The OCI operations broker reports only its last direct-deployment attempt.
 * GitHub Actions uses a separate, successful full-stack deployment path and
 * does not rewrite that history. Always reconcile the *live* API and loaded
 * frontend against main before describing production health.
 */
export type ProductionReleaseAlignment =
  'current' | 'synced' | 'behind' | 'mismatch' | 'unavailable';

export function productionReleaseAlignment(
  latestMain: string | null,
  liveApi: string | null,
  loadedFrontend: string | null
): ProductionReleaseAlignment {
  if (!liveApi || !loadedFrontend) return 'unavailable';
  if (liveApi !== loadedFrontend) return 'mismatch';
  if (!latestMain) return 'synced';
  return latestMain === liveApi ? 'current' : 'behind';
}

type DirectJob = {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  sha: string | null;
  updatedAt: string | null;
};

/** A failed *direct* job must not be presented as a failure of a newer live release. */
export function isSupersededDirectOciFailure(
  job: DirectJob | null | undefined,
  latestMain: string | null,
  liveApi: string | null,
  loadedFrontend: string | null,
  apiDeployedAt: string | null
): boolean {
  if (job?.state !== 'failed' ||
    productionReleaseAlignment(latestMain,liveApi,loadedFrontend) !== 'current')
    return false;
  if (job.sha && job.sha !== liveApi) return true;
  const attemptedAt = job.updatedAt ? Date.parse(job.updatedAt) : NaN;
  const liveAt = apiDeployedAt ? Date.parse(apiDeployedAt) : NaN;
  return Number.isFinite(attemptedAt) && Number.isFinite(liveAt) &&
    attemptedAt < liveAt;
}
