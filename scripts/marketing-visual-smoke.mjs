// Public-site browser smoke; authenticated tenant surfaces require a test tenant.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.UI_SMOKE_URL || 'http://127.0.0.1:4173/';
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(base);
    if (response.ok) break;
  } catch {}
  if (attempt === 59) throw new Error('Vite marketing preview not available: ' + base);
  await new Promise(resolve => setTimeout(resolve, 300));
}
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.une-marketing').count(), 1, 'Marketing root missing');
    assert.equal(await page.locator('.une-site-header .une-brand-logo-image--static').count(), 1,
      'UNE static fallback is missing');
    if (width === 1280) {
      const logo = page.locator('.une-site-header .une-brand-logo');
      const state = await logo.evaluate(node => ({
        interim: node.classList.contains('une-brand-logo--interim'),
        animated: !!node.querySelector('.une-brand-logo-image--animated'),
        staticLoaded: node.querySelector('.une-brand-logo-image--static').complete
      }));
      assert.equal(state.staticLoaded, true, 'UNE static fallback failed to load');
      assert.ok(state.interim || state.animated, 'Fast-connection UNE logo is not animated');
      await page.waitForTimeout(180);
      const frameOne = await logo.screenshot();
      await page.waitForTimeout(1200);
      const frameTwo = await logo.screenshot();
      assert.ok(!frameOne.equals(frameTwo), 'UNE logo stays static instead of changing colours');
    }
    const metrics = await page.evaluate(() => {
      const ui = document.querySelector('.une-marketing');
      const rootStyle = getComputedStyle(document.documentElement);
      const visibleActions = [...ui.querySelectorAll('.une-button')]
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
      return {
        rootWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        primary: rootStyle.getPropertyValue('--md-primary').trim(),
        minActionHeight: Math.min(...visibleActions.map(element => element.getBoundingClientRect().height)),
        actionsCount: visibleActions.length
      };
    });
    assert.equal(metrics.primary, '#1d4ed8', 'Shared platform brand token not loaded');
    assert.ok(metrics.rootWidth <= metrics.viewportWidth + 2,
      'Horizontal page overflow at ' + width + 'px: ' + JSON.stringify(metrics));
    assert.ok(metrics.actionsCount > 0, 'No actionable CTA at width ' + width);
    assert.ok(metrics.minActionHeight >= 44,
      'Undersized CTA at ' + width + 'px: ' + JSON.stringify(metrics));
    assert.deepEqual(errors, [], 'Browser runtime error at ' + width + 'px');
    await page.screenshot({ path: 'artifacts/marketing-' + width + '.png', fullPage: true });
    console.log('Marketing visual smoke passed at ' + width + 'px', metrics);

    if (width === 1280) {
      const slowPage = await browser.newPage({ viewport: { width, height: 900 } });
      await slowPage.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', {
          configurable: true,
          value: { effectiveType: '2g', saveData: true, downlink: 0.4, rtt: 950 }
        });
      });
      await slowPage.goto(base, { waitUntil: 'networkidle' });
      const slowLogo = slowPage.locator('.une-site-header .une-brand-logo');
      assert.equal(await slowLogo.locator('.une-brand-logo-image--static').count(), 1);
      assert.equal(await slowLogo.locator('.une-brand-logo-image--animated').count(), 0,
        'Slow-connection branding fetched the optional full animation');
      assert.equal(await slowLogo.evaluate(node => node.classList.contains('une-brand-logo--interim')), false,
        'Slow connection should show a plain, non-animated logo');
      assert.equal(await slowLogo.locator('.une-brand-logo-image--static').evaluate(node => getComputedStyle(node).animationName),
        'none', 'Slow-connection fallback should not animate');
      await slowPage.close();
    }
    await page.close();
  }
} finally {
  await browser.close();
}
