import { useFormFactor } from '../../workspace/Responsive/useFormFactor';
import React,{createContext,useContext,type ReactNode} from 'react';
import type {LightningPageMetadata,LibraryComponentMetadata} from '../../metadata/Definitions/metadata';
import {findRegisteredComponent} from '../../components/Registry/componentRegistryLookup';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import {resolvePageComponentStyle} from '../../pages/TemplatePageRuntime/pageComponentLayout';

/** A protected administration control may opt into a Page Builder instance.
 * The slot is presentation-only: existing server-authorised operations and
 * event handlers remain in the owning admin screen.
 */
type PlatformSlotDevice='Desktop'|'Tablet'|'Phone';
const context=createContext<{page:LightningPageMetadata;device:PlatformSlotDevice;libraryComponents:readonly LibraryComponentMetadata[]}|null>(null);
// The platform slot uses the same viewport boundaries as the shared shell.
export function PlatformPageSlotsProvider({page,children,libraryComponents=[]}:{
 page:LightningPageMetadata;children:ReactNode;libraryComponents?:readonly LibraryComponentMetadata[];
}){
 const device: PlatformSlotDevice = useFormFactor();
 return <context.Provider value={{page,device,libraryComponents}}>{children}</context.Provider>;
}
/** Resolve editable presentation properties from the already-authorized active system page.
 * Only non-executable presentation values are exposed; validation, writes and RBAC
 * remain owned by the original control and OneEngine API.
 */
export function usePlatformSlotPresentation(slotKey:string){
 const state=useContext(context);
 const instance=state?.page.components.find(item=>
  item.properties.platformSlotKey===slotKey && item.visible!==false);
 if(!instance)return {};
 const properties=instance.properties as Record<string,unknown>;
 return {
  label:typeof properties.controlLabel==='string' ? properties.controlLabel : undefined,
  placeholder:typeof properties.controlPlaceholder==='string' ? properties.controlPlaceholder : undefined,
  helpText:typeof properties.controlHelpText==='string' ? properties.controlHelpText : undefined,
  description:typeof properties.controlDescription==='string' ? properties.controlDescription : undefined
 };
}
export function PlatformPageSlot({slotKey,children}:{
 slotKey:string;children:ReactNode;
}){
 const state=useContext(context);
 if(!state)return <>{children}</>;
 const instance=state.page.components.find(item=>item.properties.platformSlotKey===slotKey);
 if(!instance)return <>{children}</>;
 if(instance.visible===false)return null;
 const computed=resolvePageComponentStyle(instance.properties,instance.type,state.device);
 const style=Object.keys(computed).length?computed:{display:'contents' as const};
 const panel=instance.type==='Custom:SystemPanel'
  ?findRegisteredComponent(state.libraryComponents,'SystemPanel','page'):undefined;
 // Only the trusted bundled, published panel may host live privileged controls.
 // Existing operations still use the originating OneEngine-authorised handlers.
 const content=panel?.trustedBundled===true
  ?<RegisteredComponent formulaInstanceId={instance!.id} definition={panel} props={{...instance.properties,children}} layoutTransparent/>:children;
 return <div data-page-instance={instance.id} data-platform-slot={slotKey}
  aria-label={typeof instance.properties.controlLabel==='string' && instance.properties.controlLabel ? instance.properties.controlLabel : instance.label} style={style}>{content}</div>;
}
