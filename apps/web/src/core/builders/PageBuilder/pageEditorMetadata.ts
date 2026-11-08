import type { LightningPageTemplate } from '../../metadata/Definitions/metadata';
export const pageTemplates: Array<{ id: LightningPageTemplate; label: string; regions: Array<'header' | 'main' | 'sidebar'> }> = [
    { id: 'one-region', label: 'One Region', regions: ['main'] },
    { id: 'header-main', label: 'Header and Main', regions: ['header', 'main'] },
    { id: 'main-sidebar', label: 'Main with Sidebar', regions: ['main', 'sidebar'] },
    { id: 'header-main-sidebar', label: 'Header, Main, and Sidebar', regions: ['header', 'main', 'sidebar'] }
  ];

export function pageStringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}
