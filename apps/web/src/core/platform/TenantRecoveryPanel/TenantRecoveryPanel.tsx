type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export default function TenantRecoveryPanel(_props: {
  request: Request;
  operator: boolean;
  permitted: boolean;
  tenantId?: string;
}) {
  return null;
}
