import { PageFormulaScope } from '../../../components/RegisteredComponent/PageFormulaScope';
import * as React from 'react';

import { usePageEditorState } from './usePageEditorState';
import { usePageComponentProperties } from './inspector/usePageComponentProperties';
import { usePagePalette } from './ribbon/usePagePalette';
import { usePageLayoutActions } from './management/usePageLayoutActions';
import { useCanvasGestures } from './canvas/useCanvasGestures';
import { usePageComponentActions } from './usePageComponentActions';
import { usePageManagement } from './management/usePageManagement';
import { usePagePlacement } from './canvas/usePagePlacement';
import type { PageBuilderProps, PageBuilderComponents } from './PageBuilderTypes';
import PageRecordControls from './inspector/PageRecordControls';
import PageManagerView from './management/PageManagerView';
import PageManagerDialogs from './management/PageManagerDialogs';

const PageDesignSurface = React.lazy(() => import('./PageDesignSurface'));

export function createPageBuilder(components: PageBuilderComponents) {
  return function PageBuilder(props: PageBuilderProps) {
    const editorState = usePageEditorState(props);
    const componentProperties = usePageComponentProperties(props, editorState);
    const palette = usePagePalette(props, editorState);
    const layoutActions = usePageLayoutActions(props, editorState, componentProperties);
    const canvasGestures = useCanvasGestures(editorState, props, componentProperties);
    const componentActions = usePageComponentActions(props, editorState, componentProperties, layoutActions);
    const management = usePageManagement(props, editorState, layoutActions);
    const placement = usePagePlacement(editorState, props, componentActions);
    const { page, libraryComponents, editorMode } = props;
    const { isPhoneBuilder, previewMode, externalPreviewTarget } = editorState;

    return (
      <PageFormulaScope key={page?.apiName} components={page?.components} catalog={libraryComponents}><div className={`builder-page ${editorMode ? "builder-editor-mode" : "builder-list-mode"} ${isPhoneBuilder ? 'builder-phone-read-mode' : ''} ${previewMode ? 'builder-interactive-preview' : ''}`}>
        <PageRecordControls props={props} editorState={editorState} />
        {editorMode && isPhoneBuilder && <p className="builder-phone-guidance" role="status">
          Phone preview: tap a component to edit its properties. Drag-and-drop and canvas positioning are available on tablet and desktop.
        </p>}
        <PageManagerView props={props} editorState={editorState} management={management} layoutActions={layoutActions} />
        {(editorMode || externalPreviewTarget) && <React.Suspense fallback={<p role="status">Loading page editor…</p>}>
          <PageDesignSurface props={props} components={components} editorState={editorState}
            componentProperties={componentProperties} palette={palette} layoutActions={layoutActions}
            canvasGestures={canvasGestures} componentActions={componentActions} management={management}
            placement={placement} />
        </React.Suspense>}
        <PageManagerDialogs props={props} editorState={editorState} management={management} />
      </div></PageFormulaScope>
    );
  };
}
