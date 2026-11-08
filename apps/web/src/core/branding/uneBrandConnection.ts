/**
 * UNE branding should never force a ~540 KB decorative download on
 * bandwidth-constrained connections. If Network Information is unavailable
 * (Safari/Firefox), prefer the cached animation after its complete download;
 * the static logo stays visible throughout.
 */
export type BrandConnection = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
};

export function shouldLoadAnimatedBrand(
  reducedMotion: boolean,
  connection?: BrandConnection | null,
): boolean {
  if (reducedMotion || connection?.saveData) return false;
  if (connection?.effectiveType && /^(slow-2g|2g|3g)$/i.test(connection.effectiveType)) return false;
  if (typeof connection?.downlink === 'number' && connection.downlink < 1.5) return false;
  if (typeof connection?.rtt === 'number' && connection.rtt > 500) return false;
  return true;
}
