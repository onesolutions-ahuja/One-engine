import {PlatformPasswordResetPanel} from '../../security/AccountAssist/AccountAssist';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export default function TenantRecoveryPanel({request, permitted, tenantId}: {
  request: Request;
  operator: boolean;
  permitted: boolean;
  tenantId?: string;
}) {
  if (!permitted || !tenantId) return null;
  return <PlatformPasswordResetPanel request={request} tenantId={tenantId} />;
}
