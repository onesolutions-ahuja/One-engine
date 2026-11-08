import BuilderTemplatePreviewLayout from '../../TemplatePreview/BuilderTemplatePreviewLayout';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { childrenOf } from '../../../pages/TemplatePageRuntime/pageComponentLayout';
import { createPageCanvasRenderer } from './canvas/createPageCanvasRenderer';
import { createPageRibbon } from './ribbon/createPageRibbon';
import type { PageBuilderProps, PageBuilderComponents } from './PageBuilderTypes';
import PageEditorToolbar from './ribbon/PageEditorToolbar';
import PageCanvasStage from './canvas/PageCanvasStage';
import type { usePageEditorState } from './usePageEditorState';
import type { usePageComponentProperties } from './inspector/usePageComponentProperties';
import type { usePagePalette } from './ribbon/usePagePalette';
import type { usePageLayoutActions } from './management/usePageLayoutActions';
import type { useCanvasGestures } from './canvas/useCanvasGestures';
import type { usePageComponentActions } from './usePageComponentActions';
import type { usePageManagement } from './management/usePageManagement';
import type { usePagePlacement } from './canvas/usePagePlacement';

const PagePropertyInspector = React.lazy(() => import('./inspector/PagePropertyInspector'));

interface PageDesignSurfaceProps {
  props: PageBuilderProps;
  components: PageBuilderComponents;
  editorState: ReturnType<typeof usePageEditorState>;
  componentProperties: ReturnType<typeof usePageComponentProperties>;
  palette: ReturnType<typeof usePagePalette>;
  layoutActions: ReturnType<typeof usePageLayoutActions>;
  canvasGestures: ReturnType<typeof useCanvasGestures>;
  componentActions: ReturnType<typeof usePageComponentActions>;
  management: ReturnType<typeof usePageManagement>;
  placement: ReturnType<typeof usePagePlacement>;
}

export default function PageDesignSurface({
  props, components, editorState, componentProperties, palette, layoutActions,
  canvasGestures, componentActions, management, placement,
}: PageDesignSurfaceProps) {
  const { page, editorMode } = props;
  const { externalPreviewTarget, device, activePanel, componentPanelWidth } = editorState;
  const canvasRenderer = createPageCanvasRenderer(editorState, props, componentProperties, canvasGestures, placement, componentActions, layoutActions, components);
  const ribbon = createPageRibbon(editorState, layoutActions, props, componentProperties, componentActions, management, palette);
  const { renderPageComponent } = canvasRenderer;
  const { designInPanel } = ribbon;
  return <>
        {externalPreviewTarget && createPortal(
          <div className="external-page-preview">
            <div className={`external-preview-viewport ${device.toLowerCase()}`}>
              <div className={`record-preview ${page.layoutMode === 'free-canvas' ? 'free-canvas-preview' : 'record-page-preview'} ${device === 'Phone' ? 'phone-preview' : device === 'Tablet' ? 'tablet-preview' : ''}`}>
                {page.layoutMode === 'free-canvas'
                  ? <div className="free-canvas-stage" style={{ width: page.canvasWidth, height: page.canvasHeight, position: 'relative' }}>
                      {childrenOf(page.components, null).map((component) => renderPageComponent(component, page.components.findIndex((item) => item.id === component.id), true, true))}
                    </div>
                  : <BuilderTemplatePreviewLayout page={page} phone={device==='Phone'}
                      header={childrenOf(page.components,null).filter(item=>(item.region??'main')==='header').map((item,index)=>renderPageComponent(item,index,true,true))}
                      main={childrenOf(page.components,null).filter(item=>(item.region??'main')==='main').map((item,index)=>renderPageComponent(item,index,true,true))}
                      sidebar={childrenOf(page.components,null).filter(item=>item.region==='sidebar').map((item,index)=>renderPageComponent(item,index,true,true))}/>}
              </div>
            </div>
          </div>,
          externalPreviewTarget
        )}
        {editorMode && <>
        <PageEditorToolbar editorState={editorState} ribbon={ribbon} props={props} componentProperties={componentProperties} />

        <div className={`page-builder-layout canvas-unified-builder reference-builder-layout ${page.layoutMode === 'free-canvas' ? 'modern-canvas-builder' : ''} ${activePanel === null ? 'unified-panel-collapsed' : ''} ${designInPanel ? 'has-design-dock' : ''}`}
          style={{ '--component-panel-width': `${componentPanelWidth}px` } as React.CSSProperties}>
        <PageCanvasStage ribbon={ribbon} editorState={editorState} placement={placement} props={props} components={components} canvasGestures={canvasGestures} canvasRenderer={canvasRenderer} componentProperties={componentProperties} />
  {editorState.ribbonPropertyHost && <React.Suspense fallback={null}><PagePropertyInspector editorState={editorState} props={props} placement={placement} components={components} componentProperties={componentProperties} ribbon={ribbon} componentActions={componentActions} /></React.Suspense>}
        </div>
        </>}
  </>;
}
