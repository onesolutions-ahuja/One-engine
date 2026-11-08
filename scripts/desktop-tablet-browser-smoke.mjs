// Source-backed UI surface acceptance. Uses the actual app CSS and common
// platform design tokens. This is a visual/accessibility contract, not a CRUD
// or payment workflow test; authenticated app flows are tested separately.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium,webkit} from 'playwright';
const require=createRequire(import.meta.url);
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const root=file('apps/web/src/core/workspace/WorkspaceTheme/appleTheme.css');
const base=file('apps/web/src/core/workspace/WorkspaceTheme/design-system.css');
const accessibilityFindings=[];
const cases=[
 {name:'mail',path:'apps/web/src/core/mail/MailWebmail.css',html:`
 <div class="md-mail"><header class="md-mail-header"><strong class="md-mail-brand">Mail</strong>
 <label class="md-mail-search">Search mail<input aria-label="Search mail"></label><div class="md-mail-header-actions"><button class="md-mail-icon-button">Refresh</button></div></header>
 <div class="md-mail-layout"><aside class="md-mail-sidebar"><button class="md-mail-compose-button">Compose</button>
 <nav aria-label="Mailboxes"><button class="md-mail-folder is-active">Inbox</button><button class="md-mail-folder">Sent</button></nav></aside>
 <main class="md-mail-main"><div class="md-mail-list-toolbar"><div class="md-mail-list-heading"><h1>Inbox</h1></div></div>
 <div class="md-mail-message-list"><button class="md-mail-message-row is-unread"><span>●</span><strong class="md-mail-row-sender">Example sender</strong><span class="md-mail-row-content">Appointment confirmation</span><time class="md-mail-row-date">Today</time></button>
 <button class="md-mail-message-row"><span>○</span><strong class="md-mail-row-sender">Service</strong><span class="md-mail-row-content">Message preview</span><time class="md-mail-row-date">Yesterday</time></button>
 </div></main></div></div>`},
 {name:'setup',path:'apps/web/src/core/workspace/WorkspaceTheme/applicationPolish.css',html:`
 <main class="lightning home-content"><section class="welcome-banner"><div class="welcome-copy"><h1>Setup Home</h1><h2>Welcome to Setup</h2><p>Configure your organisation</p></div>
 <div class="welcome-quick"><strong class="quick-label">Quick access</strong><button>Object Manager</button><button>Flows</button><button>Permissions</button></div></section>
 <nav aria-label="Setup shortcuts" class="shortcut-grid"><button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">Object Manager</span><span class="shortcut-description">Manage objects and relationships</span><span class="shortcut-arrow" aria-hidden="true">→</span></button>
<button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">Page Builder</span><span class="shortcut-description">Create and edit application pages</span><span class="shortcut-arrow" aria-hidden="true">→</span></button>
<button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">Flows</span><span class="shortcut-description">Build automated business processes</span><span class="shortcut-arrow" aria-hidden="true">→</span></button>
<button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">Reports</span><span class="shortcut-description">Create and run reports</span><span class="shortcut-arrow" aria-hidden="true">→</span></button>
<button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">Dashboards</span><span class="shortcut-description">Visualise key metrics</span><span class="shortcut-arrow" aria-hidden="true">→</span></button>
<button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">AppExchange</span><span class="shortcut-description">Discover organisation apps</span><span class="shortcut-arrow" aria-hidden="true">→</span></button>
<button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">Company Settings</span><span class="shortcut-description">Manage organisation settings</span><span class="shortcut-arrow" aria-hidden="true">→</span></button>
<button class="shortcut-card"><span class="shortcut-icon" aria-hidden="true">▣</span><span class="shortcut-title">Permission Sets</span><span class="shortcut-description">Manage access to apps and data</span><span class="shortcut-arrow" aria-hidden="true">→</span></button></nav>
 <section class="home-lower-grid"><div class="surface recent-surface"><header class="section-heading"><h2>Recent security activity</h2></header></div>
 <div class="surface help-surface"><header class="section-heading"><h2>Resources</h2></header></div></section></main>`},
 {name:'permissions',path:'apps/web/src/core/workspace/WorkspaceTheme/applicationPolish.css',html:`
 <main class="lightning permissions-page"><h1>Permissions</h1><nav class="permission-tabs" aria-label="Permission sections"><button class="active">Permission sets</button><button>Users</button></nav>
 <section class="permission-workspace"><aside class="permission-list"><h2>Policies</h2><button class="permission-list-item selected">Tenant Developer</button></aside>
 <div class="permission-editor"><h2>Object permissions</h2><div class="permission-table-wrap permission-desktop-matrix">
 <table><thead><tr><th>Object</th><th>Read</th><th>Edit</th></tr></thead><tbody><tr><th>Account</th><td><input type="checkbox" aria-label="Read Account" checked></td><td><input type="checkbox" aria-label="Edit Account"></td></tr></tbody></table>
 </div></div></section></main>`},
];
mkdirSync('artifacts',{recursive:true});
const selectedEngine=process.env.METADRIVE_UI_SMOKE_BROWSER||'chromium';
if(!['chromium','webkit'].includes(selectedEngine))throw Error('Unsupported UI smoke engine: '+selectedEngine);
for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>name===selectedEngine)){
 const browser=await browserType.launch({headless:true});
 try{
  for(const {width,height} of [{width:834,height:1194},{width:1194,height:834},{width:1440,height:900}]){
   for(const scheme of ['light','dark']){
    const page=await browser.newPage({viewport:{width,height},colorScheme:scheme,hasTouch:width===834,deviceScaleFactor:1});
    try{
     for(const scenario of cases){
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">'+scenario.html+'</body></html>');
      await page.addStyleTag({content:base+'\n'+(scenario.name==='setup' ? file('apps/web/src/core/workspace/WorkspaceTheme/styles.css')+'\n' : '')+root+'\n'+file(scenario.path)+(scenario.name==='setup'?'\n'+file('apps/web/src/core/workspace/WorkspaceTheme/settingsAppearance.css'):'' )});
      const state=await page.evaluate(()=>{
       const element=document.querySelector('main')||document.body;
       const focusables=[...document.querySelectorAll('button,input,select')].filter(el=>el.getClientRects().length>0);
       return {width:document.documentElement.scrollWidth,viewport:window.innerWidth,
        buttons:focusables.length,ink:getComputedStyle(element).color};
      });
      assert.ok(state.width<=width+3,
       `${scenario.name} ${engine} ${width} ${scheme} has horizontal overflow: ${JSON.stringify(state)}`);
      assert.ok(state.buttons>0,`Missing interactive controls on ${scenario.name}`);
      if(scenario.name==='setup'){
       const cards=await page.locator('.shortcut-card').evaluateAll(nodes=>nodes.map(card=>{
        const icon=card.querySelector('.shortcut-icon').getBoundingClientRect();
        const title=card.querySelector('.shortcut-title').getBoundingClientRect();
        const description=card.querySelector('.shortcut-description').getBoundingClientRect();
        const outer=card.getBoundingClientRect();
        return {iconRight:icon.right,titleLeft:title.left,descLeft:description.left,outerRight:outer.right,descRight:description.right,iconWidth:icon.width};
       }));
       assert.equal(cards.length,8,'Fixture must represent all eight actual Setup shortcuts');
       assert.ok(cards.every(card=>card.iconWidth===50&&card.iconRight+4<=card.titleLeft&&card.iconRight+4<=card.descLeft&&card.descRight<=card.outerRight),
        `Setup shortcut icon/text overlaps at ${width}px: ${JSON.stringify(cards)}`);
      }
      await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
      const violations=await page.evaluate(async()=>{
       const result=await window.axe.run(document.body,
        {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
       return result.violations.filter(item=>['critical','serious'].includes(item.impact))
        .map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.slice(0,10).map(node=>({
        target:node.target,reason:node.failureSummary?.slice(0,180)}))}));
      });
      if(violations.length){
       const finding={app:scenario.name,engine,width,scheme,violations};
       accessibilityFindings.push(finding);
       console.error('Accessibility regression:',JSON.stringify(finding));
      }
      if(width===834 || width===1440){
       await page.screenshot({path:`artifacts/${scenario.name}-${engine}-${width}-${scheme}.png`,fullPage:true});
      }
      console.log('Desktop/tablet UI fixture passed',scenario.name,engine,width,scheme);
     }
    }finally{await page.close();}
   }
  }
  // Verify the same native-control selectors used by Page Builder and published
  // Page Runtime. Property styles must not paint invisible metadata frames.
  const native=await browser.newPage({viewport:{width:1024,height:768}});
  try{
   await native.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
   <body>
    <div id="buttonHost" class="record-component" data-page-appearance="button" data-page-style="background radius padding" style="--md-page-background:#112233;--md-page-radius:13px;--md-page-padding:8px">
      <div class="registered-component"><div class="one-ui"><button class="one-btn">Run configured Flow</button></div></div>
    </div>
    <div id="tabsHost" class="record-component" data-page-appearance="tabs" data-page-style="background" style="--md-page-background:#abcdee">
      <div class="registered-component"><div class="one-tabs"><button class="one-tab">Details</button></div></div>
    </div>
    <div id="borderHost" class="registered-component md-component-appearance" style="--md-border-width:6px">
      <div class="one-ui"><button class="one-btn">Native width</button></div>
    </div>
   </body></html>`);
   // Load independent runtime stylesheets exactly as production does. Combining
   // them can invalidate later rule blocks when imported CSS contains directives.
   await native.addStyleTag({content:file('apps/web/src/core/components/RegisteredComponent/registeredComponentAppearance.css')});
   await native.addStyleTag({content:file('apps/web/src/core/pages/TemplatePageRuntime/pageComponentAppearance.css')});
   // OneButton transitions background for 150ms. Read the settled state rather
   // than sampling an intermediate colour immediately after style injection.
   await native.waitForTimeout(250);
   const state=await native.evaluate(()=>{
    const style=selector=>getComputedStyle(document.querySelector(selector));
    return {
     buttonHostBg:style('#buttonHost').backgroundColor,
     buttonBg:style('#buttonHost .one-btn').backgroundColor,
     buttonRadius:style('#buttonHost .one-btn').borderTopLeftRadius,
     buttonPadding:style('#buttonHost .one-btn').paddingTop,
     tabsHostBg:style('#tabsHost').backgroundColor,
     tabsContainerBg:style('#tabsHost .one-tabs').backgroundColor,
     tabButtonBg:style('#tabsHost .one-tab').backgroundColor,
     borderHostWidth:style('#borderHost').borderTopWidth,
     borderButtonWidth:style('#borderHost .one-btn').borderTopWidth,
     nativeBackgroundVar:style('#buttonHost .one-btn').getPropertyValue('--md-page-background'),
     nativeMatches:document.querySelectorAll('[data-page-appearance="button"][data-page-style~="background"] .registered-component .one-btn').length,
     ruleCounts:[...document.styleSheets].map(sheet=>sheet.cssRules.length),
     backgroundRules:[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules])
       .filter(rule=>rule.selectorText?.includes('[data-page-appearance="button"][data-page-style~="background"]') && rule.style)
       .map(rule=>({background:rule.style.getPropertyValue('background-color'),priority:rule.style.getPropertyPriority('background-color')})).slice(-4)
    };
   });
   console.log('Published native appearance computed',engine,JSON.stringify(state));
   assert.equal(state.buttonHostBg,'rgba(0, 0, 0, 0)','No decorative Builder frame');
   assert.equal(state.buttonBg,'rgb(17, 34, 51)','Native button receives background');
   assert.equal(state.buttonRadius,'13px','Native button receives radius');
   assert.equal(state.buttonPadding,'8px','Native button receives padding');
   assert.equal(state.tabsHostBg,'rgba(0, 0, 0, 0)','No decorative tab frame');
   assert.equal(state.tabsContainerBg,'rgb(171, 205, 238)','Style tab container');
   assert.notEqual(state.tabButtonBg,'rgb(171, 205, 238)','Do not repaint individual tabs');
   assert.equal(state.borderHostWidth,'0px','Registered metadata host has no border');
   assert.equal(state.borderButtonWidth,'6px','Registered native control receives border');
   console.log('Native appearance parity fixture passed',engine);
  }finally{await native.close();}
 }finally{await browser.close();}
}

assert.deepEqual(accessibilityFindings,[],`Blocking application accessibility issues: ${JSON.stringify(accessibilityFindings,null,2)}`);
