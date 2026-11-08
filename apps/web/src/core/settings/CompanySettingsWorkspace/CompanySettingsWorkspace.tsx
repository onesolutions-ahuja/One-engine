import type { ObjectMetadata } from '../../metadata/Definitions/metadata';
import { cloneElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import BusinessCalendarSettings from '../../platform/BusinessCalendarSettings/BusinessCalendarSettings';
import OfflineBriefcaseSettings from '../../platform/OfflineBriefcaseSettings/OfflineBriefcaseSettings';
import MetadataPackageManager from '../../applications/MetadataPackages/MetadataPackageManager';
import { apiRequest } from '../../authentication/Client/authClient';
import './CompanySettingsWorkspace.css';
type Section = 'general'|'currency'|'branding'|'business'|'contacts'|'mobile'|'integrations'|'security'|'developer';
type DeveloperDestination = {label:string;workspace:string;description:string;allowed:boolean};
const sections:ReadonlyArray<{id:Section;label:string}>=[
{id:'general',label:'General'},{id:'currency',label:'Currency & Locale'},
{id:'branding',label:'Branding'},{id:'business',label:'Business Settings'},
{id:'contacts',label:'Contacts'},{id:'mobile',label:'Mobile & Offline'},{id:'integrations',label:'Integrations'},
{id:'security',label:'Security & Recovery'},{id:'developer',label:'Developer'}];
/** Presentation only: retains existing OneEngine-protected runtime controls and slots. */
export default function CompanySettingsWorkspace({company,domains,developer,usage,calendar,recovery,mfa,emailRecovery,locks,sessions,audit,onNavigateDeveloper,developerAccess,objects=[],mobile=false,initialSection,onSelectSection,securitySubsection,onSelectSecurityArea}:{
objects?:ObjectMetadata[];company:ReactNode;domains:ReactNode;developer:ReactNode;usage:ReactNode;calendar?:ReactNode;
recovery:ReactNode;mfa:ReactNode;emailRecovery:ReactNode;locks:ReactNode;sessions:ReactNode;audit:ReactNode;
 onNavigateDeveloper?:(workspace:string)=>void;
 developerAccess?:{metadata:boolean;apps:boolean;packages?:boolean;flows:boolean;dashboards:boolean;reports:boolean;approvals:boolean;security:boolean};
 mobile?:boolean; initialSection?:string; onSelectSection?:(section:Section|null)=>void;
 securitySubsection?:string;onSelectSecurityArea?:(area:'access'|'recovery'|'history')=>void;
}){
 const resolvedInitialSection=sections.find(item=>item.id===initialSection)?.id;
 const [active,setActive]=useState<Section>(resolvedInitialSection??'general');
 const validSecurityArea=(securitySubsection==='recovery'||securitySubsection==='history')?securitySubsection:'access';
 const [securityView,setSecurityView]=useState<'access'|'recovery'|'history'>(validSecurityArea);
 useEffect(()=>setSecurityView(validSecurityArea),[securitySubsection]);
 const [mobileSection,setMobileSection]=useState<Section|null>(mobile?(resolvedInitialSection??null):null);
 useEffect(()=>{setActive(resolvedInitialSection??'general');if(mobile)setMobileSection(resolvedInitialSection??null);},[resolvedInitialSection,mobile]);
 const currentSection=mobile ? mobileSection : active;
 const sectionTitle=active==='security'&&securitySubsection==='connected-apps'?'Connected Apps'
  :active==='security'&&securitySubsection==='audit-trail'?'Audit Trail'
  :resolvedInitialSection?sections.find(item=>item.id===active)?.label??'Company Settings':'Company Settings';
 const sectionPath=resolvedInitialSection?('Setup / Organisation / '+(active==='security'?'Security & Recovery':sectionTitle)):'Setup / Organisation';
 const rights=developerAccess;
 const destinations:DeveloperDestination[]=[
  {label:'Object Manager',workspace:'object-manager',description:'Objects, fields and relationships',allowed:!!rights?.metadata},
  {label:'App Builder',workspace:'app-manager',description:'Apps, menus and navigation',allowed:!!rights?.apps},
  {label:'Page Editor',workspace:'page-builder',description:'Page layouts and publishing',allowed:!!rights?.metadata},
  {label:'Flow Builder',workspace:'flow-builder',description:'Flows and Screen Flows',allowed:!!rights?.flows},
  {label:'Scheduled Flows',workspace:'scheduled-flows',description:'Automation schedules',allowed:!!rights?.flows},
  {label:'Flow Interviews',workspace:'flow-interviews',description:'In-progress Screen Flow interviews',allowed:!!rights?.flows},
  {label:'Flow Logs',workspace:'flow-logs',description:'Automation executions and errors',allowed:!!rights?.flows},
  {label:'Automation Settings',workspace:'automation-settings',description:'Automation configuration',allowed:!!rights?.flows},
  {label:'Dashboard Builder',workspace:'dashboard-builder',description:'Dashboards and visualisations',allowed:!!rights?.dashboards},
  {label:'Report Builder',workspace:'report-builder',description:'Reports and data analysis',allowed:!!rights?.reports},
  {label:'OneEngine Permissions',workspace:'rbac',description:'Developer and builder access policies',allowed:!!rights?.security}
 ];
 const available=destinations.filter(item=>item.allowed);
 const visibleSections=sections.filter(section=>
  (section.id!=='developer'||available.length>0) &&
  (!mobile || !['security','integrations'].includes(section.id) || !!rights?.security)
 );
 return <div className={mobile?'company-workspace company-workspace-mobile':'company-workspace'}>
   <header className="company-workspace-heading">
     {mobile && mobileSection && <button type="button" className="company-workspace-mobile-back"
       onClick={()=>{setMobileSection(null);onSelectSection?.(null);}}><ChevronLeft size={19} aria-hidden="true" /> Company Settings</button>}
     <div><p className="company-workspace-eyebrow">{sectionPath}</p>
     <h1>{mobile&&mobileSection?securitySubsection==='connected-apps'?'Connected Apps':securitySubsection==='audit-trail'?'Audit Trail':visibleSections.find(item=>item.id===mobileSection)?.label:sectionTitle}</h1>
     {!mobileSection && <p>Manage your organisation, currency, branding and security settings.</p>}</div>
   </header>
   <nav className="company-workspace-tabs" aria-label="Company settings sections">
     {visibleSections.map(section=><button key={section.id} type="button" className={active===section.id?'active':''}
       aria-current={active===section.id?'page':undefined} onClick={()=>{setActive(section.id);if(mobile)setMobileSection(section.id);onSelectSection?.(section.id);}}>{section.label}</button>)}
   </nav>
   {mobile && mobileSection===null && <nav className="company-workspace-mobile-menu" aria-label="Company settings sections">
     {visibleSections.map(section=><button key={section.id} type="button" onClick={()=>{setMobileSection(section.id);setActive(section.id);onSelectSection?.(section.id);}}>
       <span className="company-workspace-mobile-section-icon"><Settings2 size={17} aria-hidden="true" /></span>
       <span>{section.label}</span><ChevronRight size={18} aria-hidden="true" />
     </button>)}
   </nav>}
   {currentSection && <div className={"company-workspace-body company-workspace-section-"+currentSection}>
     {/* CompanySettings currently contains both company details and currency sections.
         Render it once, avoiding duplicate state and network requests. */}
     {(currentSection==='general'||currentSection==='currency'||currentSection==='contacts'||currentSection==='branding')&&(typeof company === 'object' && company !== null && 'props' in company ? cloneElement(company as ReactElement, {section:currentSection}) : company)}
     {currentSection==='integrations'&&<section className="company-workspace-stack">{domains}{developer}</section>}
     {currentSection==='security'&&<section className="company-workspace-stack">
      <nav role="tablist" className="md-admin-tabstrip" aria-label="Security settings areas">
       {([{id:'access',label:'Sign-in and access'},{id:'recovery',label:'Account recovery'},{id:'history',label:'Login activity'}] as const).map(item=>
        <button key={item.id} type="button" role="tab" id={'company-security-tab-'+item.id}
         aria-controls={'company-security-panel-'+item.id} aria-selected={securityView===item.id}
         onClick={()=>{setSecurityView(item.id);onSelectSecurityArea?.(item.id);}}>{item.label}</button>)}
      </nav>
      <div role="tabpanel" id={'company-security-panel-'+securityView}
       aria-labelledby={'company-security-tab-'+securityView} className="md-security-content">
       {securityView==='access'&&mfa}
       {securityView==='recovery'&&<>{emailRecovery}{locks}{sessions}{recovery}</>}
       {securityView==='history'&&audit}
      </div>
     </section>}
     {currentSection==='business'&&<div className="company-workspace-secondary">
       {calendar??<BusinessCalendarSettings request={apiRequest} permitted />}
       {usage}
     </div>}
     {currentSection==='mobile'&&<OfflineBriefcaseSettings request={apiRequest} permitted objects={objects} />}
     {currentSection==='developer'&&<><section className="company-workspace-card" aria-label="Developer tools"><h2>Developer tools</h2><p>Build and manage your apps with OneEngine-controlled access.</p><div className="company-developer-links">{available.map(item=><button type="button" key={item.workspace} onClick={()=>onNavigateDeveloper?.(item.workspace)} disabled={!onNavigateDeveloper}><strong>{item.label}</strong><span>{item.description}</span><span aria-hidden="true">›</span></button>)}</div></section>
       <MetadataPackageManager request={apiRequest} permitted={!!rights?.metadata} canManage={!!(rights?.packages??rights?.apps)} /></>}
   </div>}
 </div>;
}

