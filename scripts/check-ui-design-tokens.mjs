// Presentation-only regression checks. Run with: node scripts/check-ui-design-tokens.mjs
// This checks baseline contracts; a passing result does not replace browser screenshots.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(new URL(path, 'file://' + root), 'utf8');
const moved = {
  'MarketingSite.tsx':'core/public/MarketingSite/MarketingSite.tsx',
  'marketing.css':'core/public/MarketingSite/marketing.css',
  'design-system.css':'core/workspace/WorkspaceTheme/design-system.css',
  'styles.css':'core/workspace/WorkspaceTheme/styles.css',
  'styles-md227.css':'core/builders/PageBuilder/styles-md227.css',
  'TenantManagement.css':'core/platform/TenantManagement/TenantManagement.css',
  'TenantDomains.css':'core/platform/TenantDomains/TenantDomains.css',
  'registeredComponentAppearance.css':'core/components/RegisteredComponent/registeredComponentAppearance.css',
  'ChecklistMultiSelect.css':'component-libraries/shared/primitives/ChecklistMultiSelect/ChecklistMultiSelect.css',
  'SmartFieldInput.css':'component-libraries/shared/primitives/SmartFieldInput/SmartFieldInput.css',
  'FlowReferenceInput.css':'core/builders/FlowReferenceInput/FlowReferenceInput.css',
  'ReferenceBrowser.css':'component-libraries/shared/primitives/ReferenceBrowser/ReferenceBrowser.css',
  'AppManagerList.css':'core/applications/AppManagerList/AppManagerList.css',
  'CompanySettingsWorkspace.css':'core/settings/CompanySettingsWorkspace/CompanySettingsWorkspace.css'
};
const web = path => {
  let actual = moved[path] || path;
  if (actual.startsWith('custom-components/component-libraries/')) {
    const file = actual.split('/').at(-1);
    actual = file === 'manifest.json' ? 'component-libraries/manifest.json'
      : 'component-libraries/shared/' + file;
  }
  return read('apps/web/src/' + actual);
};

const tokens = web('design-system.css');
for (const token of [
  '--md-primary:', '--md-success:', '--md-danger:', '--md-warning:',
  '--md-text:', '--md-muted:', '--md-border:', '--md-font:',
  '--md-fs-xs:', '--md-fs-body:', '--md-space-1:', '--md-space-12:',
  '--md-control-height:', '--md-control-touch:', '--md-scroll-thumb:'
]) assert.ok(tokens.includes(token), 'Missing shared design token: ' + token);

const runtime = web('main.tsx');
const marketing = web('MarketingSite.tsx');
assert.ok(runtime.includes("WorkspaceTheme/design-system.css"),
  'The public entry must load shared design tokens once for marketing and the workspace');
assert.ok(runtime.includes('const Workspace = lazy('),
  'Workspace must remain lazily loaded');
assert.ok(!runtime.includes("WorkspaceTheme/styles-part2.css") && !runtime.includes("WorkspaceTheme/styles-audit.css"),
  'Workspace must load one consolidated stylesheet, not a conflicting three-file cascade');
const stylesheetWithImports = (relative, visited = new Set()) => {
  if (visited.has(relative)) return '';
  visited.add(relative);
  const css = web(relative);
  const imports = [...css.matchAll(/@import\s+["']([^"']+\.css)["'];?/g)]
    .map(match => match[1])
    .filter(path => path.startsWith('./'))
    .map(path => {
      // All imports of the consolidated workspace CSS live beneath WorkspaceTheme.
      const prefix = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/') + 1) : 'core/workspace/WorkspaceTheme/';
      const segments = (prefix + path).split('/');
      const resolved = [];
      for (const segment of segments) {
        if (segment === '..') resolved.pop();
        else if (segment !== '.') resolved.push(segment);
      }
      return resolved.join('/');
    });
  return css + '\\n' + imports.map(path => stylesheetWithImports(path, visited)).join('\\n');
};
const workspaceCss = stylesheetWithImports('styles.css');
for (const selector of ['.palette-backdrop', '.profile-menu-panel', '.flow-workarea.flow-toolbox-collapsed']) {
  assert.ok(workspaceCss.includes(selector), 'Consolidated workspace stylesheet is missing ' + selector);
}

for (const path of ['styles.css', 'styles-md227.css']) {
  const css = web(path);
  assert.doesNotMatch(css, /font-size:\s*(?:[7-9]|10)px\b/,
    path + ' contains operational microtype below 11px');
}

const tenant = web('TenantManagement.css');
assert.ok(!tenant.includes('#12605c'), 'Removed teal tenant primary has returned');
assert.match(tenant, /--md-primary/, 'Tenant administration must use shared primary');
const tenantDomains = web('TenantDomains.css');
assert.ok(!tenantDomains.includes('#0b4550') && !tenantDomains.includes('#126474'),
  'Tenant Domains must not restore the retired teal primary');
assert.match(tenantDomains, /--md-primary/, 'Tenant Domains buttons must use shared primary');
const appearance = web('registeredComponentAppearance.css');
assert.ok(!appearance.includes('#3176cc'), 'Shared card fallback must use design tokens');
for (const path of ['ChecklistMultiSelect.css', 'SmartFieldInput.css', 'FlowReferenceInput.css']) {
  const css = web(path);
  assert.doesNotMatch(css, /font-size:\s*(?:[7-9]|10)px\b/,
    'No operational microtype below 11px: ' + path);
}
for (const file of [
  'SmartFieldInput.css','FlowReferenceInput.css','ReferenceBrowser.css',
  'AppManagerList.css','CompanySettingsWorkspace.css','TenantManagement.css',
]) assert.match(web(file), /scrollbar-width:\s*thin/, 'Missing scrollbar styling in ' + file);


function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  assert.match(value, /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'Expected a valid hex colour: ' + hex);
  const full = value.length === 3 ? [...value].map(part => part + part).join('') : value;
  const channels = [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const muted = tokens.match(/--md-muted:\s*(#[0-9a-f]{3,6})/i)?.[1];
assert.ok(muted, 'Shared muted text token must have a concrete fallback colour');
for (const background of ['#ffffff', '#f6f8ff']) {
  assert.ok(contrastRatio(muted, background) >= 4.5,
    'Muted text must meet WCAG AA 4.5:1 contrast on ' + background + '; got ' + contrastRatio(muted, background).toFixed(2) + ':1');
}
const marketingCss = web('marketing.css');
assert.match(marketingCss, /--une-muted:var\(--md-muted,#596579\)/,
  'Marketing muted text must retain the contrast-safe token fallback');
for (const [foreground, background, label] of [
  ['#596579', '#f6f8ff', 'marketing muted text'],
  ['#5146b8', '#ffffff', 'POS accent text'],
  ['#9a4318', '#ffffff', 'kiosk accent text'],
]) assert.ok(contrastRatio(foreground, background) >= 4.5,
  label + ' must meet WCAG AA 4.5:1 contrast; got ' + contrastRatio(foreground, background).toFixed(2) + ':1');


// File-level MetaDrive UI audit: source-level regression contracts.
// Device/tenant acceptance still requires authenticated browser verification.
const recordCss = web('core/records/RecordWorkspace/recordsListToolbar.css');
const recordView = web('core/records/RecordWorkspace/recordWorkspaceViews.tsx');
const builderCss = web('styles-md227.css');
const installedAppsCss = web('core/workspace/SetupShell/InstalledAppMenu.css');
assert.match(workspaceCss, /html, body, #root\s*\{\s*min-width:\s*320px/,
  'Core shell must not force overflow at the 320px acceptance viewport');
assert.doesNotMatch(workspaceCss, /#(?:0176d3|032d60|706e6b|444|c9c9c9|dddbda)\b/i,
  'Legacy Salesforce-colour literals must be replaced with shared token aliases');
assert.match(workspaceCss, /\.lightning \.notification-panel\s*\{right:max\(0px,env\(safe-area-inset-right,0px\)\)/,
  'Notifications must not be positioned off the viewport right edge');
assert.match(workspaceCss, /\.lightning \.icon-button\s*\{min-width:var\(--md-control-touch,44px\)/,
  'Coarse-pointer toolbar icons must reach the 44px touch minimum');
assert.match(workspaceCss, /prefers-reduced-motion:reduce/,
  'Core shell must respect reduced-motion preference');
assert.match(recordCss, /\.records-card-fields dt\s*\{\s*font-size:var\(--md-fs-sm,12px\)/,
  'Record card field labels must remain readable');
assert.match(recordView, /listFields\.filter\(field=>field\.apiName!=='Name'\)\.slice\(0,3\)/,
  'Records cards must show no more than three meaningful metadata fields');
// Table mode must not let long text, rich HTML, or action buttons stretch
// individual rows. Cards, checklist and phone views remain independent.
assert.match(recordView, /records-table records-data-table/,
  'Shared record list table must use the scoped single-line styles');
assert.match(recordView, /className="records-table-cell-value"/,
  'Visible record cell values must be bounded by a single-line wrapper');
assert.match(recordCss, /\.records-data-table tbody tr\s*\{\s*height:44px/,
  'Every standard Records table row must have the same baseline height');
assert.match(recordCss, /\.records-data-table \.records-table-cell-value\s*\{[^}]*white-space:nowrap/s,
  'Long record values must truncate rather than wrap');
assert.match(recordCss, /\.records-data-table \.record-row-actions\s*\{[^}]*flex-wrap:nowrap/s,
  'Record actions must not wrap into a second row');

assert.match(builderCss, /\.free-canvas-resize-handle\s*\{\s*width:var\(--md-control-height,40px\)/,
  'Builder resize handle must be large enough for desktop and touch');
assert.match(builderCss, /\.component-card-action,\.component-favourite\).*min-width:var\(--md-control-touch,44px\)/s,
  'Builder palette add/favourite affordances must be touch-sized');
assert.match(installedAppsCss, /header-page-action:focus-visible/,
  'App navigation controls must expose keyboard focus');
const insertGallery = web('core/builders/PageBuilder/SmartInsertRibbon.tsx');
assert.match(insertGallery, /<button className="smart-insert-tile"[\s\S]*?onClick=\{\(\)=>onInsert\(item\.type\)\}/s,
  'A discoverable click/tap-to-add action must accompany builder drag');

console.log('Shared visual design and WCAG AA contrast contract checks passed.');
