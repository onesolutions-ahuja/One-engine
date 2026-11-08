import {
  AppWindow, BarChart3, Building2, CalendarClock, CirclePause, Database,
  FileText, History, KeyRound, LayoutDashboard, LayoutTemplate, LockKeyhole,
  Network, Plug, Settings2, ShieldCheck, ShoppingBag, Smartphone, Users,
  UserRound, Webhook, Workflow
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type NavigationAppearance = {icon: LucideIcon; tone: string};

/** Presentation metadata only; routing, installation and RBAC still use setupNavigation.
 * Item-specific artwork and gradient tokens are shared by desktop, icon rail and mobile.
 * All artwork is rendered from the project's existing open-source Lucide dependency.
 */
const groups: Record<string, NavigationAppearance> = {
  'Platform Administration': {icon: ShieldCheck, tone: 'indigo'},
  'Company Settings': {icon: Building2, tone: 'sky'},
  'Platform Tools': {icon: Database, tone: 'violet'},
  'Integrations': {icon: Plug, tone: 'teal'},
  'Automation': {icon: Workflow, tone: 'orange'},
  'Analytics': {icon: BarChart3, tone: 'emerald'},
  'Security': {icon: LockKeyhole, tone: 'blue'}
};

const items: Record<string, NavigationAppearance> = {
  'Tenant Management': {icon: Building2, tone: 'indigo'},
  'Company Settings': {icon: Building2, tone: 'sky'},
  'Security & Recovery': {icon: ShieldCheck, tone: 'blue'},
  'Connected Apps': {icon: Plug, tone: 'teal'},
  'Audit Trail': {icon: History, tone: 'coral'},
  'Setup Home': {icon: LayoutDashboard, tone: 'blue'},
  'Object Manager': {icon: Database, tone: 'cobalt'},
  'Records': {icon: FileText, tone: 'cobalt'},
  'Universal Data Loader': {icon: Database, tone: 'teal'},
  'Page Builder': {icon: LayoutTemplate, tone: 'violet'},
  'App Manager': {icon: AppWindow, tone: 'purple'},
  'AppExchange': {icon: ShoppingBag, tone: 'pink'},
  'Named Credentials': {icon: KeyRound, tone: 'green'},
  'Webhook Endpoints': {icon: Webhook, tone: 'azure'},
  'Named Devices': {icon: Smartphone, tone: 'orchid'},
  'Flows': {icon: Workflow, tone: 'orange'},
  'Paused and Waiting Interviews': {icon: CirclePause, tone: 'lavender'},
  'Scheduled Flows': {icon: CalendarClock, tone: 'teal'},
  'Scheduled Actions': {icon: CalendarClock, tone: 'orange'},
  'Flow History': {icon: History, tone: 'coral'},
  'Process Automation Settings': {icon: Settings2, tone: 'royal'},
  'Reports': {icon: FileText, tone: 'red'},
  'Reports Builder': {icon: FileText, tone: 'red'},
  'Reports View': {icon: FileText, tone: 'red'},
  'Dashboards': {icon: BarChart3, tone: 'lime'},
  'Dashboard Builder': {icon: BarChart3, tone: 'lime'},
  'Dashboard View': {icon: BarChart3, tone: 'lime'},
  'Users': {icon: Users, tone: 'blue'},
  'Roles': {icon: ShieldCheck, tone: 'purple'},
  'Public Groups': {icon: Users, tone: 'turquoise'},
  'Profiles': {icon: UserRound, tone: 'pink'},
  'Permission Sets': {icon: LockKeyhole, tone: 'green'},
  'Permission Set Groups': {icon: ShieldCheck, tone: 'violet'},
  'Sharing Settings': {icon: Network, tone: 'cyan'},
  'Sharing Rules': {icon: Network, tone: 'amber'}
};

export default function SettingsNavigationIcon({
  group, label, className = ''
}: {group: string; label: string; className?: string}) {
  const appearance = items[label] ?? groups[group] ?? {icon: Settings2, tone: 'slate'};
  const Icon = appearance.icon;
  return <span className={`md-setup-icon md-setup-icon-${appearance.tone} ${className}`.trim()} aria-hidden="true">
    <Icon size={20} strokeWidth={2.1} />
  </span>;
}
