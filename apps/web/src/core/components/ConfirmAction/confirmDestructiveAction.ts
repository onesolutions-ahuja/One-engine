/**
 * Shared confirmation gate for user-initiated destructive UI actions.
 * Keep this in the client: server endpoints and OneEngine RBAC remain authoritative.
 * Never call from flows, seeders, automated jobs or HTTP middleware.
 */
export type DestructiveVerb = 'Delete' | 'Remove' | 'Archive' | 'Deactivate' | 'Uninstall';

export function destructiveConfirmationMessage(
  verb: DestructiveVerb,
  subject: string,
  consequence = 'This action may affect existing data or configuration.'
): string {
  const name = subject.trim() || 'this item';
  return `${verb} ${name}?\n\n${consequence}`;
}

/** Return false on Cancel. Callers must not mutate or call APIs unless true. */
export function confirmDestructiveAction(
  verb: DestructiveVerb,
  subject: string,
  consequence?: string
): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  return window.confirm(destructiveConfirmationMessage(verb, subject, consequence));
}
