// Workspace responsive regression contract for the audited Flow Builder and Setup shell.
// Uses the real consolidated stylesheet and representative production class names; screenshots
// are CI artifacts for the acceptance widths required by the UI audit.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const cssPath = new URL('../apps/web/src/core/workspace/WorkspaceTheme/styles.css', import.meta.url);
const css = readFileSync(cssPath, 'utf8').replace(/^@import[^;]+;\s*/, '');
const adaptiveCss = readFileSync(new URL('../apps/web/src/core/workspace/WorkspaceTheme/appleTheme.css', import.meta.url), 'utf8');
const settingsCss = readFileSync(new URL('../apps/web/src/core/workspace/WorkspaceTheme/settingsAppearance.css', import.meta.url), 'utf8');
mkdirSync('artifacts', { recursive: true });

const markup = `<!doctype html>
<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div class="lightning">
  <header class="salesforce-header">
    <button class="icon-button" aria-label="Open apps">▦</button>
    <div class="brand"><span class="brand-cloud">M</span><strong>MetaDrive</strong></div>
    <div class="header-searches"><button class="global-record-search" aria-label="Search records"><span>Search records…</span></button></div>
    <div class="header-tools"><button class="icon-button profile-menu-wrap" aria-label="Profile">U</button></div>
  </header>
  <nav class="app-strip"><strong class="app-title">Setup</strong><div class="primary-tabs"><button class="primary-tab active">Home</button><button class="primary-tab">Objects</button><button class="primary-tab">Flows</button></div></nav>
  <div class="setup-layout">
    <aside class="setup-sidebar"><div class="quick-find"><div class="quick-find-title">Quick Find</div><div class="quick-find-input"><input aria-label="Quick Find" value=""></div></div>
      <div class="setup-tree"><button class="tree-item selected"><span>Flows</span></button><button class="tree-item"><span>Objects</span></button></div>
    </aside>
    <main class="workspace"><section class="flow-builder">
      <div class="flow-workarea">
        <aside class="flow-toolbox"><div class="toolbox-heading"><h2>Elements</h2></div><div class="toolbox-tabs">Elements</div><div class="toolbox-group"><h3>Logic</h3><button class="flow-element-option"><span>◇</span> Decision</button></div></aside>
        <div class="flow-canvas" style="min-width:0;min-height:420px;padding:20px"><h1>Flow Builder</h1><div class="surface" style="padding:20px">Start → Get Records → End</div></div>
        <aside class="flow-settings"><div class="settings-header"><h2>Set Up</h2></div><label>Label<input value="Get Records"></label><button class="btn btn-brand">Done</button></aside>
      </div>
    </section></main>
  </div>
</div></body></html>`;

const browser = await chromium.launch({ headless: true });
try {
  for (const { width, height } of [
    { width: 320, height: 690 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 }
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(markup, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: css });
    if (width >= 601) {
      await page.locator('.setup-sidebar').evaluate(element => element.classList.add('setup-sidebar-collapsed'));
    }
    if (width >= 821) {
      await page.locator('.flow-workarea').evaluate(element => element.classList.add('flow-toolbox-collapsed'));
    }
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const metrics = await page.evaluate(() => {
      const box = selector => {
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, position: style.position, gridColumns: style.gridTemplateColumns };
      };
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        header: box('.salesforce-header'),
        setupSidebar: box('.setup-sidebar'),
        flowWorkarea: box('.flow-workarea'),
        flowToolbox: box('.flow-toolbox'),
        flowSettings: box('.flow-settings'),
        overflowingElements: [...document.querySelectorAll('body *')].map(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '',
            text: (element.textContent || '').trim().slice(0, 40), left: rect.left, right: rect.right,
            width: rect.width, overflowX: style.overflowX, position: style.position };
        }).filter(element => element.right > window.innerWidth + 2 && element.width > 0).slice(0, 12)
      };
    });
    assert.ok(metrics.documentWidth <= width + 2,
      'Workspace overflows horizontally at ' + width + 'px: ' + JSON.stringify(metrics));
    assert.ok(metrics.header.height <= 56,
      'Header must remain at most 56px tall at ' + width + 'px: ' + JSON.stringify(metrics.header));
    assert.notEqual(metrics.flowSettings.display, 'none',
      'Flow settings must remain available at ' + width + 'px: ' + JSON.stringify(metrics.flowSettings));
    if (width <= 820) {
      assert.match(metrics.flowWorkarea.gridColumns, /^\d+(?:\.\d+)?px$|^minmax\(0px, 1fr\)$/,
        'Narrow Flow Builder should use one column at ' + width + 'px: ' + JSON.stringify(metrics.flowWorkarea));
      assert.equal(metrics.flowSettings.position, 'static',
        'Narrow Flow settings should stack in document flow at ' + width + 'px');
    } else {
      assert.match(metrics.flowWorkarea.gridColumns, /^56px/,
        'Tablet Flow Builder should preserve the 56px toolbox rail at ' + width + 'px: ' + JSON.stringify(metrics.flowWorkarea));
      assert.equal(metrics.flowSettings.position, 'absolute',
        'Tablet inspector should overlay rather than squeeze the canvas at ' + width + 'px');
    }
    assert.ok(metrics.setupSidebar.width >= (width <= 600 ? width - 2 : 55),
      'Setup navigation must remain usable at ' + width + 'px: ' + JSON.stringify(metrics.setupSidebar));
    // Verify essential shell controls can be reached by keyboard, not just hovering.
    const focusable = page.getByRole('button', { name: 'Open apps' });
    await focusable.focus();
    const focus = await focusable.evaluate(element => ({
      visible: document.activeElement === element,
      outlineStyle: getComputedStyle(element).outlineStyle,
      outlineWidth: getComputedStyle(element).outlineWidth,
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width
    }));
    assert.ok(focus.visible && focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) >= 2,
      'Workspace global action must have visible keyboard focus at ' + width + 'px: ' + JSON.stringify(focus));
    assert.ok(focus.width >= 40 && focus.height >= 40,
      'Workspace global action must remain at least 40px at ' + width + 'px: ' + JSON.stringify(focus));
    await page.screenshot({ path: 'artifacts/workspace-flow-builder-' + width + '.png', fullPage: true });
    console.log('Workspace responsive smoke passed at ' + width + 'px', JSON.stringify(metrics));
    await page.close();
  }

  // Real Setup sidebar selectors at desktop widths: collapsed means icons
  // only, and both actual expand triggers must be visible and clickable.
  const railMarkup = `<!doctype html><html lang="en">
  <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body><div class="lightning md-setup-light">
    <header class="salesforce-header">
      <button class="md-sidebar-trigger" type="button" aria-label="Open navigation" aria-controls="md-setup-sidebar" aria-expanded="false">☰</button>
      <strong>MetaDrive</strong>
    </header>
    <main class="setup-layout">
      <aside class="setup-sidebar setup-sidebar-collapsed" id="md-setup-sidebar">
        <div class="setup-sidebar-toolbar">
          <strong>Setup</strong>
          <button type="button" class="setup-sidebar-toggle" aria-label="Expand Setup menu" aria-expanded="false">❯</button>
        </div>
        <div class="quick-find"><div class="quick-find-title">Quick Find</div><div class="quick-find-input"><input aria-label="Quick Find"></div></div>
        <div class="setup-tree">
          <div class="setup-tree-group"><div class="tree-group-label">Platform Tools</div>
            <button type="button" class="tree-item selected" aria-label="Open Page Builder" title="Page Builder">
              <span class="md-setup-icon md-setup-icon-purple" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="currentColor"/></svg></span>
              <span>Page Builder</span><svg width="13" height="13"></svg>
            </button>
            <button type="button" class="tree-item" aria-label="Open App Manager" title="App Manager">
              <span class="md-setup-icon md-setup-icon-blue" aria-hidden="true"><svg width="17" height="17"><circle cx="8" cy="8" r="7" fill="currentColor"/></svg></span>
              <span>App Manager</span><svg width="13" height="13"></svg>
            </button>
          </div>
          <div class="setup-tree-group"><div class="tree-group-label">Integrations</div>
            <button type="button" class="tree-item" aria-label="Open Named Credentials" title="Named Credentials">
              <span class="md-setup-icon md-setup-icon-cyan" aria-hidden="true"><svg width="17" height="17"><circle cx="8" cy="8" r="7" fill="currentColor"/></svg></span>
              <span>Named Credentials</span><svg width="13" height="13"></svg>
            </button>
          </div>
        </div>
        <div class="sidebar-footer">Setup menu</div>
      </aside>
      <section class="workspace"><h1>Page Builder</h1><p>Manage pages and layouts</p></section>
    </main>
  </div></body></html>`;
  // Collapsed Setup is hidden on tablet; the always-visible header trigger
  // must reopen and close the same navigation with the real stylesheet stack.
  for(const width of [768,820,1023]){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.setContent(railMarkup,{waitUntil:'domcontentloaded'});
    await page.addStyleTag({content:css});
    await page.addStyleTag({content:adaptiveCss});
    await page.addStyleTag({content:settingsCss});
    await page.evaluate(()=>{
      const sidebar=document.querySelector('#md-setup-sidebar');
      const rail=document.querySelector('.setup-sidebar-toggle');
      const header=document.querySelector('.md-sidebar-trigger');
      const change=()=>{
        const collapsed=sidebar.classList.toggle('setup-sidebar-collapsed');
        rail.setAttribute('aria-label',collapsed?'Expand Setup menu':'Collapse Setup menu');
        header.setAttribute('aria-label',collapsed?'Open navigation':'Close navigation');
        rail.setAttribute('aria-expanded',String(!collapsed));
        header.setAttribute('aria-expanded',String(!collapsed));
      };
      rail.addEventListener('click',change);
      header.addEventListener('click',change);
    });
    const header=page.getByRole('button',{name:'Open navigation'});
    assert.notEqual(await header.evaluate(x=>getComputedStyle(x).display),'none',
      'Tablet must expose reopen control at '+width);
    await header.click();
    assert.notEqual(await page.locator('#md-setup-sidebar').evaluate(x=>getComputedStyle(x).display),'none',
      'Tablet sidebar must reopen at '+width);
    await page.getByRole('button',{name:'Collapse Setup menu'}).click();
    assert.equal(await page.locator('#md-setup-sidebar').evaluate(x=>getComputedStyle(x).display),'none',
      'Tablet sidebar must collapse at '+width);
    await page.getByRole('button',{name:'Open navigation'}).click();
    assert.notEqual(await page.locator('#md-setup-sidebar').evaluate(x=>getComputedStyle(x).display),'none');
    await page.screenshot({path:'artifacts/setup-tablet-reopened-'+width+'.png',fullPage:true});
    await page.close();
  }
  for (const width of [1024, 1440]) {
    const page = await browser.newPage({ viewport: {width, height: 850} });
    await page.setContent(railMarkup, {waitUntil:'domcontentloaded'});
    await page.addStyleTag({content:css});
    await page.addStyleTag({content:adaptiveCss});
    await page.addStyleTag({content:settingsCss});
    await page.evaluate(() => {
      const aside = document.querySelector('#md-setup-sidebar');
      const railButton = document.querySelector('.setup-sidebar-toggle');
      const headerButton = document.querySelector('.md-sidebar-trigger');
      const toggle = () => {
        const collapsed = aside.classList.toggle('setup-sidebar-collapsed');
        railButton.setAttribute('aria-label', collapsed ? 'Expand Setup menu' : 'Collapse Setup menu');
        railButton.setAttribute('aria-expanded', String(!collapsed));
        headerButton.setAttribute('aria-label', collapsed ? 'Open navigation' : 'Close navigation');
        headerButton.setAttribute('aria-expanded', String(!collapsed));
      };
      railButton.addEventListener('click', toggle);
      headerButton.addEventListener('click', toggle);
    });
    const initial = await page.evaluate(() => {
      const aside = document.querySelector('.setup-sidebar');
      const cssStyle = selector => getComputedStyle(document.querySelector(selector));
      const rect = aside.getBoundingClientRect();
      return {
        width:rect.width,
        label:cssStyle('.tree-item > span:not(.md-setup-icon)').display,
        icon:cssStyle('.tree-item .md-setup-icon').display,
        group:cssStyle('.tree-group-label').display,
        search:cssStyle('.quick-find').display,
        toggle:cssStyle('.setup-sidebar-toggle').display,
        headerTrigger:cssStyle('.md-sidebar-trigger').display,
        selectedBg:cssStyle('.tree-item.selected').backgroundColor
      };
    });
    assert.ok(initial.width >= 55 && initial.width <= 66,
      'Collapsed Setup must be a real narrow icon rail at '+width+': '+JSON.stringify(initial));
    assert.equal(initial.label,'none','Collapsed Setup must hide menu labels');
    assert.equal(initial.group,'none','Collapsed Setup must hide group headings');
    assert.equal(initial.search,'none','Collapsed Setup must hide Quick Find');
    assert.notEqual(initial.icon,'none','Collapsed Setup must retain coloured icons');
    assert.notEqual(initial.toggle,'none','Collapsed Setup must keep its expand control');
    assert.notEqual(initial.headerTrigger,'none','Collapsed Setup must keep the header expand control');
    await page.screenshot({path:'artifacts/setup-icon-rail-'+width+'.png',fullPage:true});
    await page.getByRole('button',{name:'Expand Setup menu'}).click();
    const expanded = await page.locator('.setup-sidebar').boundingBox();
    assert.ok(expanded.width >= 200,'Expand toggle must restore the full Setup menu at '+width);
    assert.notEqual(await page.locator('.tree-item > span:not(.md-setup-icon)').first().evaluate(node => getComputedStyle(node).display),'none');
    await page.getByRole('button',{name:'Collapse Setup menu'}).click();
    await page.getByRole('button',{name:'Open navigation'}).click();
    assert.ok((await page.locator('.setup-sidebar').boundingBox()).width >= 200,
      'Header reopen control must restore expanded Setup menu at '+width);
    await page.screenshot({path:'artifacts/setup-expanded-'+width+'.png',fullPage:true});
    console.log('Setup icon rail and reopen controls passed at '+width+'px');
    await page.close();
  }
} finally {
  await browser.close();
}
