import type { ConnectorApp } from './ConnectorAppWorkspace';

const validUntil = (date?: string) => Boolean(date && Number.isFinite(Date.parse(date)) && Date.parse(date) > Date.now());
/** The server's tenant-scoped entitlement decision is authoritative, including perpetual licences. */
export function appLicensed(app: ConnectorApp): boolean {
  if (!app.Installed__c) return false;
  // If SQL returned a definitive licence decision, never override it with dates.
  if (app.LicenceStatus__c !== undefined) return app.LicenceStatus__c === 'ACTIVE';
  return Boolean(validUntil(app.LicenceExpiresAt__c)
    || (app.TrialUsed__c && validUntil(app.TrialExpiresAt__c)));
}
