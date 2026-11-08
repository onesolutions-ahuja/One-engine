import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, BarChart3, BellRing, CalendarCheck2, Check, CheckCircle2, ChevronDown, ClipboardList, CloudUpload, CreditCard, Globe2, HeartHandshake, LayoutDashboard, Mail, Menu, MessageCircle, MonitorSmartphone, PackageCheck, QrCode, ShieldCheck, ShoppingBag, ShoppingCart, Smartphone, Sparkles, Store, TabletSmartphone, UtensilsCrossed, Wifi, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './marketing.css';
import { UneBrandLogo } from '../../branding/UneBrandLogo';

const prefix = import.meta.env.BASE_URL;
const loginHref = import.meta.env.VITE_MARKETING_LOGIN_URL || `${prefix}login`;
const contactEmail = import.meta.env.VITE_MARKETING_CONTACT_EMAIL || 'info@unesolutions.co.uk';
const demoHref = 'mailto:' + contactEmail + '?subject=' + encodeURIComponent('Une Solutions — I would like a demo');
const enquiryHref = 'mailto:' + contactEmail + '?subject=' + encodeURIComponent('Une Solutions — Business software enquiry');

type Solution = { title: string; description: string; icon: LucideIcon; color: string; tag: string };
const solutions: Solution[] = [
  { title: 'POS & Till', description: 'Serve customers faster, handle orders and keep every sale organised.', icon: CreditCard, color: 'blue', tag: 'Sell with ease' },
  { title: 'Self-service kiosk', description: 'Let customers browse, customise and place their own orders.', icon: TabletSmartphone, color: 'orange', tag: 'Shorter queues' },
  { title: 'Kitchen display', description: 'Keep incoming orders visible to the right kitchen stations.', icon: ClipboardList, color: 'pink', tag: 'Clearer kitchens' },
  { title: 'Online ordering', description: 'Give customers a simple way to order for collection or delivery.', icon: ShoppingBag, color: 'violet', tag: 'More ways to order' },
  { title: 'QR table ordering', description: 'Let guests scan a code and order without waiting for a menu.', icon: QrCode, color: 'cyan', tag: 'Better table service' },
  { title: 'Loyalty & rewards', description: 'Recognise your regulars with offers and rewards that bring them back.', icon: HeartHandshake, color: 'pink', tag: 'Repeat business' },
  { title: 'Appointments & bookings', description: 'Take enquiries and help customers book through smart conversations.', icon: CalendarCheck2, color: 'blue', tag: 'Stay booked' },
  { title: 'WhatsApp & custom bots', description: 'Automate common questions, reminders and business-specific journeys.', icon: MessageCircle, color: 'green', tag: 'Always in touch' },
  { title: 'Reports to your inbox', description: 'Get useful business updates and dashboards delivered by email.', icon: BarChart3, color: 'orange', tag: 'Stay informed' },
  { title: 'Stock & operations', description: 'Connect everyday sales, products and team workflows in one place.', icon: PackageCheck, color: 'violet', tag: 'Less admin' }
];

const faqs = [
  { q: 'Can Une Solutions work with my existing business?', a: 'Yes. We start with your day-to-day process and help you choose the right modules, devices and integrations. You do not have to change everything at once.' },
  { q: 'Can I use it on a phone, tablet or computer?', a: 'Our web experience is designed for modern browsers on desktop, tablet, Android and iOS. Device-specific installation options depend on your solution and deployment.' },
  { q: 'What happens when the internet goes down?', a: 'Supported workflows can cache work locally and sync when a connection returns. Real-time kitchen, payment and external delivery functions still require a supported connection; we agree on an offline plan for each setup.' },
  { q: 'Can you connect to our payment and delivery services?', a: 'We offer API-based connectors for supported payment, messaging and delivery services. Availability depends on the provider, your credentials and the configuration of your solution.' },
  { q: 'Can you customise our solution?', a: 'Absolutely. We can tailor ordering, customer journeys, notifications, reporting and integrations around how your business operates.' },
];

function Brand({ light = false }: { light?: boolean }) {
  return <a className={'une-brand' + (light ? ' une-brand-light' : '')} href={prefix} aria-label="Une Solutions homepage">
    <UneBrandLogo className="une-marketing-logo" decorative />
  </a>;
}

function DashboardPreview() {
  return <div className="une-preview une-dashboard-preview" aria-label="Illustrative business dashboard preview">
    <div className="une-preview-toolbar"><div className="une-mini-logo"><UneBrandLogo className="une-mini-mark" decorative /><span>Une Workspace</span></div><div className="une-toolbar-right"><span className="une-live-dot" /> Live overview <span className="une-avatar">JD</span></div></div>
    <div className="une-preview-body">
      <div className="une-preview-sidebar"><LayoutDashboard size={15} /><ShoppingCart size={15} /><PackageCheck size={15} /><BarChart3 size={15} /><MessageCircle size={15} /></div>
      <div className="une-preview-main"><div className="une-preview-label">Monday overview</div><div className="une-preview-heading">Good morning <span className="une-wave">✦</span></div>
        <div className="une-metric-row"><div><small>Sales today</small><strong>£2,845</strong><em>↗ 12.8%</em></div><div><small>Orders</small><strong>128</strong><em>↗ 8.2%</em></div><div><small>Customers</small><strong>94</strong><em>↗ 5.4%</em></div></div>
        <div className="une-chart-card"><div className="une-chart-label"><strong>Sales performance</strong><span>Last 7 days · £</span></div><div className="une-bars">{[36,58,43,70,61,86,97,75,89,68,90,100].map((n,i)=><div key={i} style={{height:n+'%'}} />)}</div><div className="une-chart-footer"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div></div>
      </div>
    </div>
  </div>;
}
function KioskPreview() {
  return <div className="une-kiosk-device"><div className="une-kiosk-screen" aria-label="Illustrative self-service kiosk ordering interface">
    <div className="une-kiosk-head"><span className="une-small-sun">✺</span><span>Welcome to your café</span><span>EN</span></div><div className="une-kiosk-title">What looks good today?</div><div className="une-kiosk-sub">Choose your favourites, made your way.</div>
    <div className="une-kiosk-pills"><span className="active">Popular</span><span>Coffee</span><span>Food</span></div><div className="une-kiosk-items"><div><span className="une-food une-food-coffee">☕</span><strong>Flat white</strong><small>£3.20</small></div><div><span className="une-food une-food-croissant">🥐</span><strong>Butter croissant</strong><small>£2.80</small></div><div><span className="une-food une-food-sandwich">🥪</span><strong>Fresh sandwich</strong><small>£5.50</small></div><div><span className="une-food une-food-cake">🍰</span><strong>Slice of cake</strong><small>£3.80</small></div></div>
    <div className="une-kiosk-bottom"><span>🛍️ &nbsp; Your order · 2 items</span><strong>View basket →</strong></div>
  </div><div className="une-kiosk-stand" /></div>;
}
function PosPreview() {
  return <div className="une-preview une-pos-preview" aria-label="Illustrative point of sale interface"><div className="une-preview-toolbar"><div className="une-mini-logo"><UneBrandLogo className="une-mini-mark" decorative /> Une Till</div><div className="une-toolbar-right"><span className="une-live-dot" /> Till 01 · Ready</div></div>
    <div className="une-pos-layout"><div className="une-pos-products"><div className="une-pos-search">⌕ &nbsp; Search products or scan barcode</div><div className="une-pos-categories"><span>All items</span><span>Drinks</span><span>Food</span></div><div className="une-pos-grid">{[['☕','Cappuccino','£3.50'],['🥐','Croissant','£2.80'],['🥤','Iced latte','£4.20'],['🥪','Sandwich','£5.50'],['🍰','Cake','£3.80'],['🍵','Tea','£2.50']].map(x=><div key={x[1]}><span>{x[0]}</span><strong>{x[1]}</strong><small>{x[2]}</small></div>)}</div></div><div className="une-pos-cart"><strong>Current order</strong><small>Order #1042</small><div className="une-pos-line"><span>1 × Cappuccino</span><b>£3.50</b></div><div className="une-pos-line"><span>2 × Croissant</span><b>£5.60</b></div><div className="une-pos-total"><span>Total</span><strong>£9.10</strong></div><div className="une-pos-pay">Take payment →</div></div></div>
  </div>;
}
function KdsPreview() {
  return <div className="une-preview une-kds-preview" aria-label="Illustrative kitchen display interface"><div className="une-kds-toolbar"><strong>Kitchen display</strong><span><span className="une-live-dot" /> Orders arriving</span><b>12:42</b></div><div className="une-kds-orders">
    {[{num:'042',label:'Preparing',items:['2 × Cappuccino','1 × Avocado toast','1 × Orange juice'],tone:'orange'},{num:'043',label:'New order',items:['1 × Club sandwich','2 × Flat white','1 × Muffin'],tone:'blue'},{num:'044',label:'Ready to serve',items:['2 × Chicken wrap','1 × Iced latte'],tone:'green'}].map(item=><div className={'une-kds-ticket '+item.tone} key={item.num}><div><b>#{item.num}</b><span>{item.label}</span></div><small>Table 0{Number(item.num)-40} · 4 min</small>{item.items.map(x=><p key={x}>{x}</p>)}<footer>{item.label==='Ready to serve'?'Ready ✓':'In progress'}</footer></div>)}
  </div></div>;
}

type PreviewName = 'Dashboard' | 'Kiosk' | 'POS' | 'Kitchen';
const previewTabs: { name: PreviewName; title: string; blurb: string }[] = [
  { name:'Dashboard',title:'Know how your business is doing.',blurb:'See key numbers at a glance, then have updates delivered to your inbox.' },
  { name:'Kiosk',title:'More orders. Less queueing.',blurb:'A simple, welcoming ordering journey your customers can use themselves.' },
  { name:'POS',title:'Checkout that keeps things moving.',blurb:'Put your products, orders and payment steps together for your team.' },
  { name:'Kitchen',title:'Make every order easy to follow.',blurb:'Give your chefs a clear view of what needs preparing and what is ready.' }
];

function ProductShowcase({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState<PreviewName>('Dashboard');
  const tab = previewTabs.find(x=>x.name===selected)!;
  return <div className={'une-showcase '+(compact?'une-showcase-compact':'')}>
    <div className="une-showcase-top"><div className="une-section-eyebrow">THE CONNECTED EXPERIENCE</div><h2>One business. Everything working together.</h2><p>From the first order to the final report, we help you keep things simple.</p></div>
    <div className="une-showcase-tabs" role="tablist" aria-label="Explore solution previews">{previewTabs.map(x=><button key={x.name} type="button" role="tab" aria-selected={selected===x.name} className={selected===x.name?'selected':''} onClick={()=>setSelected(x.name)}>{x.name}</button>)}</div>
    <div className="une-showcase-stage"><div className="une-showcase-device">{selected==='Dashboard'?<DashboardPreview/>:selected==='Kiosk'?<KioskPreview/>:selected==='POS'?<PosPreview/>:<KdsPreview/>}</div><div className="une-showcase-copy"><span className="une-section-eyebrow">{selected.toUpperCase()} SOLUTION</span><h3>{tab.title}</h3><p>{tab.blurb}</p><ul><li><Check size={17}/> Designed around your workflow</li><li><Check size={17}/> Simple for your team to use</li><li><Check size={17}/> Connected to your business data</li></ul><a href={demoHref} className="une-inline-link">Explore this solution <ArrowUpRight size={17}/></a><small className="une-illustration-note">Illustrative interface previews. Actual layouts are tailored to your setup.</small></div></div>
  </div>;
}

function MarketingSite() {
  const [menuOpen,setMenuOpen]=useState(false);
  const [openFaq,setOpenFaq]=useState<number|null>(0);
  const closeNav=()=>setMenuOpen(false);
  return <div className="une-marketing" id="top">
    <header className="une-site-header"><div className="une-container une-header-inner"><Brand/><nav className={'une-site-nav '+(menuOpen?'is-open':'')} aria-label="Main navigation">
      <a onClick={closeNav} href="#solutions">Solutions</a><a onClick={closeNav} href="#how-it-works">How it works</a><a onClick={closeNav} href="#industries">Industries</a><a onClick={closeNav} href="#integrations">Integrations</a><a onClick={closeNav} href="#faq">FAQs</a>
      <a className="une-mobile-login" href={loginHref} onClick={closeNav}>Client login <ArrowUpRight size={15}/></a></nav><div className="une-header-actions"><a className="une-header-login" href={loginHref}>Client login <ArrowUpRight size={15}/></a><a className="une-button une-button-primary une-header-demo" href={demoHref}>Book a demo <ArrowRight size={16}/></a><button type="button" className="une-nav-toggle" onClick={()=>setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label={menuOpen?'Close navigation':'Open navigation'}>{menuOpen?<X size={23}/>:<Menu size={23}/>}</button></div></div></header>
    <main>
      <section className="une-hero"><div className="une-hero-ambient" aria-hidden="true"/><div className="une-container une-hero-layout"><div className="une-hero-content">
        <span className="une-hero-chip"><Sparkles size={14}/> MADE FOR THE WAY YOU DO BUSINESS</span><h1>Software that makes <span>business flow.</span></h1><p className="une-hero-description">From a busy till to your next customer booking — we bring your sales, orders, team and customer conversations together in one smart solution.</p>
        <div className="une-hero-actions"><a className="une-button une-button-primary" href={demoHref}>Let's talk about your business <ArrowRight size={17}/></a><a className="une-button une-button-outline" href="#solutions">Explore solutions <ArrowRight size={17}/></a></div>
        <div className="une-hero-promise"><span><CheckCircle2 size={17}/> Designed for your business</span><span><CheckCircle2 size={17}/> One connected experience</span></div>
      </div><div className="une-hero-art"><div className="une-hero-glow" aria-hidden="true"/><div className="une-hero-dashboard"><DashboardPreview/></div><div className="une-hero-phone"><div className="une-phone-speaker"/><div className="une-phone-top">UNE <span>● Online</span></div><div className="une-phone-greeting">Your favourites,<br/>just a tap away.</div><div className="une-phone-food">🥗</div><div className="une-phone-order">Order now →</div></div><div className="une-float-card une-float-sales"><span className="une-float-icon"><BarChart3 size={17}/></span><div><small>Today’s performance</small><strong>Moving up ↗</strong></div></div><div className="une-float-card une-float-message"><span className="une-float-icon pink"><BellRing size={17}/></span><div><small>Customer update</small><strong>Message sent ✓</strong></div></div></div></div>
        <div className="une-container une-hero-bottom"><div><strong>One connected business</strong><span>Sales · Kitchen · Online · Customers</span></div><div><MonitorSmartphone size={21}/><span>Phone, tablet & desktop</span></div><div><CloudUpload size={21}/><span>Supported offline sync</span></div><div><ShieldCheck size={21}/><span>Secure account access</span></div></div>
      </section>
      <section id="solutions" className="une-section une-solutions-section"><div className="une-container"><div className="une-heading-row"><div><span className="une-section-eyebrow">WHAT WE DO</span><h2>Real solutions for real business days.</h2><p>Choose what you need today. Add more when you're ready.</p></div><a href={demoHref} className="une-inline-link">Find your fit <ArrowUpRight size={18}/></a></div><div className="une-solutions-grid">{solutions.map((s)=><article className="une-solution-card" key={s.title}><div className={'une-solution-icon '+s.color}><s.icon size={23} strokeWidth={1.8}/></div><span className="une-solution-tag">{s.tag}</span><h3>{s.title}</h3><p>{s.description}</p><a href={demoHref} aria-label={"Let's discuss "+s.title}>Let's discuss {s.title} <ArrowUpRight size={15}/></a></article>)}</div></div></section>
      <section className="une-section une-showcase-section" id="product"><div className="une-container"><ProductShowcase/></div></section>
      <section className="une-section une-benefits-section" id="how-it-works"><div className="une-container une-benefits-grid"><div><span className="une-section-eyebrow">BUILT AROUND YOU</span><h2>Less juggling.<br/><span>More getting done.</span></h2><p>Whether you run a café, manage appointments or sell across locations, your systems should support your team — not slow them down.</p><a className="une-button une-button-dark" href={demoHref}>See how we can help <ArrowRight size={17}/></a></div><div className="une-benefits-list"><article><span><Zap size={22}/></span><div><h3>One smooth working day</h3><p>Bring orders, service and customer information together instead of jumping between disconnected tools.</p></div></article><article><span><MonitorSmartphone size={22}/></span><div><h3>Fits the devices you use</h3><p>Browser-based experiences for Chrome, desktop, tablets, iOS and Android — with device-specific options to suit your setup.</p></div></article><article><span><Wifi size={22}/></span><div><h3>Connection-aware working</h3><p>Supported actions can be saved for later sync. Real-time messages and payments depend on available connections.</p></div></article><article><span><ShieldCheck size={22}/></span><div><h3>More peace of mind</h3><p>Controlled user access, authentication and optional verification help you stay in charge.</p></div></article></div></div></section>
      <section id="integrations" className="une-section une-integrations-section"><div className="une-container une-integrations-layout"><div className="une-integrations-copy"><span className="une-section-eyebrow">CONNECT THE DOTS</span><h2>Your favourite channels, working together.</h2><p>Reach customers, take orders and keep your business updated with supported, configurable integrations.</p><div className="une-integration-pills"><span><MessageCircle size={18}/> WhatsApp messaging</span><span><Mail size={18}/> Email</span><span><Smartphone size={18}/> SMS & OTP</span><span><CreditCard size={18}/> Payment APIs</span><span><ShoppingBag size={18}/> Delivery APIs</span><span><Globe2 size={18}/> Custom API connections</span></div><p className="une-integrations-note">Third-party connections depend on provider approvals, supported APIs and your configured account. Brand names are used descriptively; no affiliation is implied.</p><a className="une-inline-link" href={enquiryHref}>Ask about your integration <ArrowUpRight size={17}/></a></div><div className="une-integration-visual"><div className="une-integration-orbit orbit-one"/><div className="une-integration-orbit orbit-two"/><div className="une-integration-centre"><UneBrandLogo className="une-integration-logo" /></div><span className="une-orbit-item orbit-a"><MessageCircle size={25}/><small>Messaging</small></span><span className="une-orbit-item orbit-b"><Mail size={25}/><small>Email</small></span><span className="une-orbit-item orbit-c"><ShoppingBag size={25}/><small>Delivery</small></span><span className="une-orbit-item orbit-d"><CreditCard size={25}/><small>Payments</small></span><span className="une-orbit-item orbit-e"><BarChart3 size={25}/><small>Reporting</small></span></div></div></section>
      <section className="une-section une-engage-section"><div className="une-container une-engage-layout"><div className="une-engage-phone"><div className="une-chat-top"><span className="une-chat-avatar">U</span><div><strong>Business assistant</strong><small>Automated conversation</small></div><span>•••</span></div><div className="une-chat-body"><div className="une-chat-date">Today</div><div className="une-chat-bubble left">Hi there 👋 How can we help you today?</div><div className="une-chat-bubble right">I'd like to book an appointment.</div><div className="une-chat-bubble left">Of course! Choose a day that works for you.</div><div className="une-chat-options"><span>Tomorrow</span><span>Friday</span><span>See all dates</span></div><div className="une-chat-bubble right">Friday sounds perfect!</div><div className="une-chat-bubble left">Lovely! Let's find you a time. ✨</div></div><div className="une-chat-input">Write a message... <ArrowRight size={16}/></div></div><div className="une-engage-copy"><span className="une-section-eyebrow">HAPPIER CUSTOMER CONVERSATIONS</span><h2>More personal service.<br/>Less manual messaging.</h2><p>From a simple booking request to a helpful follow-up, let everyday customer conversations take care of themselves.</p><ul><li><CheckCircle2 size={19}/> WhatsApp appointment assistants</li><li><CheckCircle2 size={19}/> Custom messaging and business bots</li><li><CheckCircle2 size={19}/> SMS, email and OTP workflows</li><li><CheckCircle2 size={19}/> Reminders and timely updates</li></ul><a className="une-button une-button-dark" href={demoHref}>Talk about automation <ArrowRight size={17}/></a><small>Example conversation for illustration. Messaging services require configuration and user permissions.</small></div></div></section>
      <section className="une-section une-reporting-section"><div className="une-container une-reporting-layout"><div className="une-reporting-copy"><span className="une-section-eyebrow">STAY IN THE KNOW</span><h2>Your business update, straight to your inbox.</h2><p>Turn the numbers that matter into useful daily or scheduled updates. See sales trends, activity and performance without having to hunt for reports.</p><div className="une-report-points"><span><Check size={17}/> Scheduled email updates</span><span><Check size={17}/> Clear business insights</span><span><Check size={17}/> Reports for the right people</span></div><a className="une-inline-link" href={enquiryHref}>Discuss reporting <ArrowUpRight size={17}/></a></div><div className="une-email-card"><div className="une-email-top"><Mail size={19}/><span>Business update</span><span className="une-email-new">INBOX</span></div><div className="une-email-inner"><small>UNE SOLUTIONS · WEEKLY RECAP</small><h3>Here's how your week went ✨</h3><div className="une-email-stats"><div><small>Total sales</small><b>£18,420</b></div><div><small>Orders</small><b>812</b></div><div><small>Returning guests</small><b>38%</b></div></div><div className="une-email-chart">{[52,75,45,85,63,90,69,98,80,93,85,100].map((x,i)=><span key={i} style={{height:x+'%'}}/>)}</div><div className="une-email-footer">Your insights, delivered on schedule. <CheckCircle2 size={17}/></div></div></div></div></section>
      <section id="industries" className="une-section une-industries-section"><div className="une-container"><div className="une-section-centred"><span className="une-section-eyebrow">WHO WE HELP</span><h2>Different businesses. One simple goal.</h2><p>Make each day a little easier for your customers and your team.</p></div><div className="une-industry-grid">{[{name:'Restaurants & takeaways',icon:UtensilsCrossed,txt:'Orders, kitchens, online sales and loyal customers.'},{name:'Cafés & quick service',icon:Store,txt:'Faster queues, easy checkout and self-ordering.'},{name:'Retail & shops',icon:ShoppingBag,txt:'Sell, track products and stay on top of daily sales.'},{name:'Clinics & services',icon:CalendarCheck2,txt:'Appointments, reminders and customer conversations.'}].map(x=><a href={enquiryHref} className="une-industry-card" key={x.name}><span><x.icon size={25}/></span><h3>{x.name}</h3><p>{x.txt}</p><ArrowUpRight size={19}/></a>)}</div></div></section>
      <section id="faq" className="une-section une-faq-section"><div className="une-container une-faq-layout"><div><span className="une-section-eyebrow">GOOD TO KNOW</span><h2>Questions?<br/>We've got answers.</h2><p>Still have something in mind? We'd love to hear about your business.</p><a className="une-inline-link" href={enquiryHref}>Ask us anything <ArrowUpRight size={18}/></a></div><div className="une-faq-list">{faqs.map((item,i)=><div className="une-faq-item" key={item.q}><button type="button" aria-expanded={openFaq===i} onClick={()=>setOpenFaq(openFaq===i?null:i)}>{item.q}<ChevronDown size={19}/></button>{openFaq===i&&<p>{item.a}</p>}</div>)}</div></div></section>
      <section id="contact" className="une-section une-final-cta"><div className="une-container"><div className="une-cta-inner"><div className="une-cta-color" aria-hidden="true"/><span className="une-cta-kicker"><Sparkles size={16}/> YOUR NEXT CHAPTER STARTS HERE</span><h2>Let's make your business<br/><em>work beautifully.</em></h2><p>Tell us what you need. We'll help you find the right solution.</p><div className="une-cta-buttons"><a href={demoHref} className="une-button une-button-light">Book a demo <ArrowRight size={17}/></a><a href={enquiryHref} className="une-button une-button-transparent">Contact our team <ArrowUpRight size={17}/></a></div><div className="une-cta-email">Prefer email? <a href={'mailto:'+contactEmail}>{contactEmail}</a></div></div></div></section>
    </main>
    <footer className="une-footer"><div className="une-container"><div className="une-footer-main"><div><Brand/><p>Practical software. Brilliantly connected.<br/>Helping everyday businesses do more.</p></div><div><strong>Explore</strong><a href="#solutions">Solutions</a><a href="#product">Product experience</a><a href="#industries">Industries</a><a href="#integrations">Integrations</a></div><div><strong>Get in touch</strong><a href={demoHref}>Book a demo</a><a href={'mailto:'+contactEmail}>Email us</a><a href="#faq">FAQs</a></div><div><strong>For customers</strong><a href={loginHref}>Client login <ArrowUpRight size={13}/></a><span>Already with Une Solutions?<br/>Your workspace is one click away.</span></div></div><div className="une-footer-bottom"><span>© {new Date().getFullYear()} Une Solutions. All rights reserved.</span><span>Built for better business.</span><a href={`${prefix}privacy`}>Privacy Policy</a><a href={loginHref}>Customer workspace <ArrowUpRight size={14}/></a></div></div></footer>
  </div>;
}

/** Public UNE Solutions policy. Intentionally independent of the authenticated workspace. */
export function PrivacyPolicyPage(){
  useEffect(()=>{
    const previous=document.title;
    document.title='Privacy Policy | UNE Solutions';
    return ()=>{document.title=previous;};
  },[]);
  return <div className="une-marketing une-privacy-page">
    <header className="une-privacy-header">
      <div className="une-container une-privacy-header-inner">
        <a href={prefix} aria-label="UNE Solutions home"><UneBrandLogo className="une-marketing-logo"/></a>
        <a href={prefix}>Back to website <ArrowRight size={16} aria-hidden="true"/></a>
      </div>
    </header>
    <main id="main-content" className="une-container une-privacy-main">
      <p className="une-section-eyebrow">UNE SOLUTIONS</p>
      <h1>Privacy Policy</h1>
      <p className="une-privacy-updated">Last updated: 6 November 2026</p>
      <p>UNE Solutions provides business software, online services and a public website. This notice explains the types of personal information that may be handled when you use our website and services, and how to contact us about it. Depending on the service, your organisation may be the controller of information entered into its workspace and UNE Solutions may act on its instructions.</p>
      <section><h2>1. Information we process</h2>
        <p>Depending on the features in use, information may include the contact details you provide when making an enquiry; account and organisation details used to sign in; records and communications entered into a customer's workspace; and technical and security information needed to operate and protect the service. Not every feature collects every category.</p></section>
      <section><h2>2. Why information is used</h2>
        <p>Information is used, as applicable, to provide requested services, authenticate users, maintain security, respond to enquiries, deliver support, operate configured business features and meet legal obligations. Where required, processing relies on an appropriate lawful basis such as contractual necessity, legitimate interests, a legal obligation or consent. Customer-controlled workspace data is handled in accordance with the customer's instructions and applicable agreements.</p></section>
      <section><h2>3. Customer workspaces and other services</h2>
        <p>Business customers manage the accounts, permissions, records and enabled integrations in their own environments. When a request concerns information your employer or another organisation controls, contact that organisation's administrator first. Providers used to host or deliver enabled services may process information according to the relevant customer agreement and safeguards.</p></section>
      <section><h2>4. Storage, security and retention</h2>
        <p>Access restrictions, authentication and technical security measures are used to protect information. No internet service can guarantee absolute security. Retention depends on the nature of the information, applicable customer agreements, configured retention controls and legal requirements. You can contact us for details relevant to your use of our services.</p></section>
      <section><h2>5. Cookies and browser storage</h2>
        <p>Website and application functions may use browser storage and cookies needed for session management, authentication, security and user preferences. Any additional analytics or similar technology, where enabled, should be disclosed and managed in accordance with applicable requirements.</p></section>
      <section><h2>6. Your data protection rights</h2>
        <p>Depending on applicable law and the circumstances, you may have rights to request access to, correction or deletion of your personal data, to object to or restrict processing, and to request portability. You may also be able to withdraw consent and complain to a data protection authority, including the UK's Information Commissioner's Office. Requests about a customer-managed workspace may need to be handled by that customer as controller.</p></section>
      <section><h2>7. Contact and changes to this policy</h2>
        <p>For privacy questions or requests, email <a href="mailto:support@unesolutions.co.uk">support@unesolutions.co.uk</a>. We may revise this notice as our services and processing arrangements change. A new update date will appear above when we publish changes.</p></section>
      <nav className="une-privacy-actions" aria-label="Privacy page navigation">
        <a href={prefix}>UNE Solutions home</a>
        <a href={loginHref}>Client sign in</a>
      </nav>
    </main>
    <footer className="une-privacy-footer"><div className="une-container">© {new Date().getFullYear()} UNE Solutions · <a href="mailto:support@unesolutions.co.uk">Contact support</a></div></footer>
  </div>;
}


/**
 * UX-0010: A public entry point for obtaining the applicable service terms.
 * Legal terms are contractual and must not be fabricated in source code.
 * VITE_TERMS_URL can direct users to the approved published document instead.
 */
export function TermsAccessPage(){
  useEffect(()=>{
    const previous=document.title;
    document.title='Service Terms | UNE Solutions';
    return ()=>{document.title=previous;};
  },[]);
  return <div className="une-marketing une-privacy-page">
    <header className="une-privacy-header">
      <div className="une-container une-privacy-header-inner">
        <a href={prefix} aria-label="UNE Solutions home"><UneBrandLogo className="une-marketing-logo"/></a>
        <a href={loginHref}>Back to sign in <ArrowRight size={16} aria-hidden="true"/></a>
      </div>
    </header>
    <main id="main-content" className="une-container une-privacy-main">
      <p className="une-section-eyebrow">UNE SOLUTIONS</p>
      <h1>Service Terms</h1>
      <p>For the terms that apply to your organisation's UNE Solutions service, please consult your service agreement or contact your organisation administrator.</p>
      <p>To request a copy of the applicable terms, email <a href="mailto:support@unesolutions.co.uk?subject=Service%20terms%20request">support@unesolutions.co.uk</a>. This information page is not a substitute for your agreed terms.</p>
      <nav className="une-privacy-actions" aria-label="Terms access navigation">
        <a href={loginHref}>Client sign in</a>
        <a href={`${prefix}privacy`}>Privacy Policy</a>
      </nav>
    </main>
    <footer className="une-privacy-footer"><div className="une-container">© {new Date().getFullYear()} UNE Solutions · <a href="mailto:support@unesolutions.co.uk">Contact support</a></div></footer>
  </div>;
}

export default MarketingSite;
