import * as React from 'react';
import { BarChart3, Banknote, Boxes, CalendarDays, FileText, Home, LayoutDashboard, Monitor, Package, Receipt,
  Settings, ShoppingCart, Tag, UserCog, Users, Wrench, type LucideIcon } from 'lucide-react';

// App pages have no icon field yet: pick one from the page label so a collapsed
// app menu is an icon rail (like a till) instead of two-letter initials.
const RULES: Array<[RegExp, LucideIcon]> = [
  [/\b(till|billing|checkout|pos|sale screen)\b/i, ShoppingCart],
  [/dashboard|overview/i, LayoutDashboard],
  [/product|item|menu/i, Tag],
  [/inventor|stock/i, Package],
  [/customer|client|contact/i, Users],
  [/employee|staff|team|user/i, UserCog],
  [/sales|order|invoice|receipt/i, Receipt],
  [/report|analytic|insight/i, BarChart3],
  [/cash|payment|money|till count/i, Banknote],
  [/display|screen|kiosk/i, Monitor],
  [/setting|config/i, Settings],
  [/booking|appointment|calendar|schedule/i, CalendarDays],
  [/job|service|repair/i, Wrench],
  [/home/i, Home],
  [/document|note|file/i, FileText],
];

export function appPageIcon(label: string): LucideIcon {
  return RULES.find(([pattern]) => pattern.test(label))?.[1] ?? Boxes;
}

export default function AppPageIcon({ label }: { label: string }) {
  const Icon = appPageIcon(label);
  return <Icon size={18} aria-hidden="true" className="md-app-nav-icon" />;
}
