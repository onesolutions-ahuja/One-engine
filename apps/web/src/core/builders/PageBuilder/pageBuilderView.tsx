// Load the editor styles in cascade order before any deferred panel mounts.
import './MobileBuilderReadMode.css';
import './CanvasFloatingActions.css';
import './PageBuilderNoCode.css';
import './SmartFormulaField.css';
import './PageBuilderRibbonBlueprint.css';
import './PageBuilderRibbonNonDesign.css';
import './PageBuilderActionRibbonCompact.css';
import './PageBuilderDesignReference.css';
import '../../pages/TemplatePageRuntime/pageComponentAppearance.css';
import '../SharedBuilderFrame/adaptiveBuilder.css';
import './PageManagerTabs.css';
import './PageComponentNavigator.css';
import './SmartIconGallery.css';
import './SmartRibbon.css';
import './SmartRibbonApprovedThreeRow.css';
import './SmartRibbonDataFormula.css';
import './SmartRibbonDesign2.css';
import './CanvasDataBindingIcons.css';
import './SmartInsertRibbon.css';
import './PageBuilderAdvancedRibbon.css';
import './UniversalRibbonInventory.css';
import './PageBuilderNumericControls.css';
import './PageBuilderRibbonPolish.css';
import './PageBuilderEightTabRibbon.css';
import './PageBuilderCanvasWorkspace.css';
import './PageBuilderEditorPreview.css';
import './SmartCanvasHandles.css';
import './PageBuilderRibbonLayout.css';
import './PageBuilderDesignDock.css';
import './PageBuilderTopbarFormula.css';
import './PageDetailsDialog.css';
import './PageInventoryImportDialog.css';

import { createPageBuilder as createWorkspace } from './editor/PageBuilderWorkspace';
import type { PageBuilderComponents } from './editor/PageBuilderTypes';

export function createPageBuilder(
  MetadataComponentProperties: PageBuilderComponents['MetadataComponentProperties'],
  MetadataBoundPageComponent: PageBuilderComponents['MetadataBoundPageComponent'],
  LightningAppRuntime: PageBuilderComponents['LightningAppRuntime'],
) {
  return createWorkspace({ MetadataComponentProperties, MetadataBoundPageComponent, LightningAppRuntime });
}
