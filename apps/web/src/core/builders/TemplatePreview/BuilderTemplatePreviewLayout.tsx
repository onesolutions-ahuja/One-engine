import type {ReactNode} from 'react';
import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';
import TemplatePageRuntimeLayout from '../../pages/TemplatePageRuntime/TemplatePageRuntimeLayout';

/** Same generic region engine for app runtime and Page Builder preview. */
export default function BuilderTemplatePreviewLayout({
 page,phone,header,main,sidebar
}: {
 page: Pick<LightningPageMetadata,'apiName'|'label'|'pageType'|'template'|'components'>;
 phone:boolean;header:ReactNode;main:ReactNode;sidebar:ReactNode;
}) {
 const standalone=page.components.find(component=>
  component.properties?.standalonePresentation===true);
 const variant=typeof standalone?.properties?.presentationLayout==='string'
  ? standalone.properties.presentationLayout : undefined;
 return <TemplatePageRuntimeLayout
  apiName={page.apiName} label={page.label} pageType={page.pageType}
  template={page.template} fullscreen={Boolean(standalone)} embedded
  phone={phone} layoutVariant={variant}
  header={header} main={main} sidebar={sidebar}/>;
}
