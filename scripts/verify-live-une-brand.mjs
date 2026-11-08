// Verify deployed UNE branding, not just the source code or the CSS fallback.
// Uses a real Chromium browser and a forced 4G-style connection, then Save-Data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const site = process.env.UNE_BRAND_LIVE_URL || 'https://unesolutions.co.uk';
const animatedAsset = new URL('/une-solutions-animated.webp', site).href;
const browser = await chromium.launch({ headless: true });
try {
  const response = await fetch(animatedAsset, { cache: 'no-store', signal: AbortSignal.timeout(16000) });
  const bytes = await response.arrayBuffer();
  const type = response.headers.get('content-type');
  console.log('LIVE_ANIMATED_ASSET', JSON.stringify({ status: response.status, bytes: bytes.byteLength, type, url: response.url }));
  assert.equal(response.status, 200, 'Original WebP is unavailable on live CDN');
  assert.ok(bytes.byteLength > 500_000, 'Original 32-frame WebP not served');

  const fast = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  const failures = [];
  fast.on('pageerror', error => failures.push(error.message));
  fast.on('response', resp => {
    if (resp.url().includes('une-solutions-animated.webp')) {
      console.log('LIVE_BROWSER_ASSET', resp.status(), resp.url);
    }
  });
  await fast.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '4g', downlink: 12, rtt: 45, saveData: false }
    });
  });
  await fast.goto(site + '/login?ui_brand_smoke=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const logo = fast.locator('.auth-card .une-brand-logo').first();
  await logo.waitFor({ state: 'visible', timeout: 20000 });
  let loaded = true;
  try {
    await logo.locator('.une-brand-logo-image--animated').waitFor({ state: 'visible', timeout: 12000 });
  } catch { loaded = false; }
  // Images load independently; do not race the static fallback against the
  // animated WebP preload. Fail if it genuinely cannot be decoded.
  await logo.locator('.une-brand-logo-image--static').evaluate(async img => {
    if (!img.complete) await new Promise((resolve, reject) => {
      img.addEventListener('load', resolve, {once:true});
      img.addEventListener('error', () => reject(new Error('Static UNE logo failed to load')), {once:true});
    });
    if (!img.naturalWidth) throw new Error('Static UNE logo failed to decode');
  });
  const state = await logo.evaluate(node => {
    const normal = node.querySelector('.une-brand-logo-image--static');
    const animated = node.querySelector('.une-brand-logo-image--animated');
    return {
      html: node.outerHTML.slice(0, 1200),
      interim: node.classList.contains('une-brand-logo--interim'),
      staticLoaded: !!normal?.complete && normal.naturalWidth > 0,
      animationFound: !!animated,
      animationLoaded: !!animated?.complete && animated.naturalWidth > 0,
      animationVisible: !!animated && getComputedStyle(animated).display !== 'none',
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        saveData: navigator.connection.saveData
      } : null,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
    };
  });
  console.log('LIVE_FAST_LOGO', JSON.stringify({ loaded, ...state, errors: failures }));
  assert.equal(state.staticLoaded, true);
  assert.equal(loaded && state.animationFound && state.animationLoaded && state.animationVisible, true,
    'Original WebP is not visibly displayed on a fast connection');

  const a = await logo.screenshot({ animations: 'allow' });
  await fast.waitForTimeout(1350);
  const b = await logo.screenshot({ animations: 'allow' });
  assert.ok(!a.equals(b), 'The original WebP is not visibly animating in Chromium');

  const slow = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  await slow.addInitScript(() => Object.defineProperty(navigator, 'connection', {
    configurable: true, value: { effectiveType: '2g', downlink: .2, rtt: 900, saveData: true }
  }));
  await slow.goto(site + '/login?ui_brand_smoke=slow', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const slowLogo = slow.locator('.auth-card .une-brand-logo').first();
  await slowLogo.waitFor({ state: 'visible', timeout: 20000 });
  await slow.waitForTimeout(700);
  assert.equal(await slowLogo.locator('.une-brand-logo-image--animated').count(), 0,
    'Static fallback expected on Save-Data / 2G');
  console.log('LIVE_SLOW_LOGO', 'static fallback confirmed');
  console.log('LIVE_UNE_ANIMATION_PASS');
} finally {
  await browser.close();
}
