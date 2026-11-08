// Automated accessibility smoke for the public frontend and login entry.
// Authenticated published pages can be included by setting UI_SMOKE_PUBLISHED_URL;
// set UI_SMOKE_OVERLAY_SELECTOR to open a dialog on that page before scanning it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const base = process.env.UI_SMOKE_URL || 'http://127.0.0.1:4173/';
const targets = [
  { name: 'marketing', url: base },
  { name: 'login', url: process.env.UI_SMOKE_AUTH_URL || new URL('/login', base).href },
  { name: 'component-fixture', url: new URL('/test/accessibility-fixture.html', base).href },
];
if (process.env.UI_SMOKE_PUBLISHED_URL) {
  targets.push({ name: 'published-page', url: process.env.UI_SMOKE_PUBLISHED_URL });
}
for (const target of targets) {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(target.url);
      if (response.ok) { ready = true; break; }
    } catch {}
    if (attempt < 59) await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Frontend preview not available for ' + target.name + ': ' + target.url);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  for (const target of targets) {
    await page.goto(target.url, { waitUntil: 'networkidle' });
    if (target.name === 'published-page' && process.env.UI_SMOKE_OVERLAY_SELECTOR) {
      await page.locator(process.env.UI_SMOKE_OVERLAY_SELECTOR).click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });
    }
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const scan = async state => {
      const results = await page.evaluate(async () => window.axe.run(
        document.querySelector('.une-marketing') || document.body,
        { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }
      ));
      const blocking = results.violations.filter(item => ['critical', 'serious'].includes(item.impact));
      if (results.violations.length) {
        console.log('axe-core violations on ' + target.name + state + ':', JSON.stringify(results.violations.map(item => ({
          id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.length
        })), null, 2));
      }
      assert.deepEqual(blocking, [], 'Critical/serious WCAG violations found by axe-core on ' + target.name + state);
      console.log('axe-core ' + target.name + state + ' scan passed: ' + results.passes.length +
        ' checks passed; ' + results.violations.length + ' non-blocking violation types.');
    };
    await scan('');
    if (target.name === 'component-fixture') {
      const busyButton = page.getByRole('button', { name: 'Working…' });
      assert.equal(await busyButton.getAttribute('aria-busy'), 'true', 'Loading buttons expose aria-busy');
      const search = page.getByRole('combobox', { name: 'Contact search' });
      await search.fill('Al');
      const listbox = page.getByRole('listbox', { name: 'Contact search suggestions' });
      await listbox.waitFor({ state: 'visible' });
      await search.press('ArrowDown');
      const activeDescendant = await search.getAttribute('aria-activedescendant');
      assert.ok(activeDescendant, 'Search arrow navigation exposes the active descendant');
      assert.equal(await page.locator('#' + activeDescendant).getAttribute('role'), 'option');
      await search.press('Enter');
      assert.equal(await search.inputValue(), 'Alice', 'Enter selects the active search suggestion');
      assert.equal(await page.getByRole('listbox').count(), 0, 'Selecting a suggestion closes the listbox');
    }
    if (target.name === 'marketing') {
      const tabs = page.locator('.une-showcase-tabs button');
      for (let index = 0; index < await tabs.count(); index++) {
        await tabs.nth(index).click();
        await scan(' / showcase tab ' + (index + 1));
      }
    }
  }
  assert.deepEqual(runtimeErrors, [], 'Frontend runtime errors during accessibility scan');
  if (!process.env.UI_SMOKE_PUBLISHED_URL) {
    console.log('Published tenant page/overlay scan skipped: set UI_SMOKE_PUBLISHED_URL and optionally UI_SMOKE_OVERLAY_SELECTOR for a configured test tenant.');
  }
  await page.close();
} finally {
  await browser.close();
}
