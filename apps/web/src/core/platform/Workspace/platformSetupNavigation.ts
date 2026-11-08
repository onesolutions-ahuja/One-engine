import {setupNavigation} from '../../metadata/Definitions/metadata';
import {platformNavigationEntries} from './platformWorkspaceMetadata';

/** Registry-first Setup navigation. Unknown entries stay visible to preserve legacy routes.
 * Route permissions remain enforced by OneEngine; this function is not an authority.
 */
export function resolveSetupNavigation(
 query:string, _canManagePlatformTenants:boolean, connectorNames:readonly string[]=[]
){
 const normalized=query.trim().toLowerCase();
 const registry=new Set(platformNavigationEntries().map(entry=>entry.label));
 const aliases:Readonly<Record<string,readonly string[]>>={
  'Company Settings':['organisation','company','branding','currency','locale'],
  'Security & Recovery':['mfa','multi-factor','passkey','password policy','session','login restrictions','authentication','recovery'],
  'Connected Apps':['oauth','oauth client','connected app','app integration','authorised applications'],
  'Audit Trail':['audit','security governance','setup history','logs']
 };
 return setupNavigation
  .map(group=>({...group,items:group.items.filter(label=>{
   if(!normalized)return true;
   const matchesLabel=label.toLowerCase().includes(normalized)
    ||group.group.toLowerCase().includes(normalized)
    ||(aliases[label]??[]).some(alias=>alias.includes(normalized));
   const matchesConnector=label==='Une Connectors'&&connectorNames.some(name=>name.toLowerCase().includes(normalized));
   return matchesLabel||matchesConnector;
  }).sort((a,b)=>Number(registry.has(b))-Number(registry.has(a)))}))
  .filter(group=>group.items.length>0);
}
