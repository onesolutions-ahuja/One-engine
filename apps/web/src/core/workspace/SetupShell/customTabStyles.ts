import { Building2, BriefcaseBusiness, CalendarDays, ClipboardList, Database, FileText, UsersRound } from 'lucide-react';

// Loaded only with the authenticated workspace, not the public login path.
export const customTabStyles = [
  { name: 'Blue', color: '#1589ee', icon: Database },
  { name: 'Green', color: '#2e844a', icon: UsersRound },
  { name: 'Orange', color: '#fe9339', icon: CalendarDays },
  { name: 'Purple', color: '#9050e9', icon: BriefcaseBusiness },
  { name: 'Red', color: '#ea001e', icon: FileText },
  { name: 'Teal', color: '#0b827c', icon: Building2 },
  { name: 'Yellow', color: '#dd7a01', icon: ClipboardList }
] as const;
