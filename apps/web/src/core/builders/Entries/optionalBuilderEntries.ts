/**
 * Optional Builder entry points. Import this module from the application shell;
 * the editing implementations are fetched only after their boundaries render.
 *
 * Published pages, flows and dashboards must continue using their existing
 * lightweight runtime modules rather than importing these editor entry points.
 */
import { lazy } from 'react';

// Existing view factories are exported as functions, not React components.
// Keep those contracts unchanged and load their modules on demand.
export const loadPageBuilderFactory = () => import('../PageBuilder/pageBuilderView').then(module => module.createPageBuilder);
export const loadObjectManagerFactory = () => import('../ObjectManager/objectManagerView').then(module => module.createObjectManager);
export const loadReportBuilder = () => import('../ReportBuilder/reportBuilderView').then(module => ({ default: module.ReportBuilder }));

export const loadFlowBuilder = () => import('../FlowBuilder/FlowBuilder');
export const loadDashboardBuilder = () => import('../DashboardBuilder/DashboardBuilder');
export const loadComponentLibrary = () => import('../../components/ComponentLibrary/ComponentLibrary');
export const loadPageComponentStyleEditor = () => import('../ComponentStyleEditor/PageComponentStyleEditor');
export const loadPageComponentVisualEditor = () => import('../ComponentStyleEditor/PageComponentVisualEditor');
export const loadCustomComponentPropertyEditor = () => import('../ComponentProperties/CustomComponentPropertyEditor');

export const LazyFlowBuilder = lazy(loadFlowBuilder);
export const LazyDashboardBuilder = lazy(loadDashboardBuilder);
export const LazyComponentLibrary = lazy(loadComponentLibrary);
export const LazyPageComponentStyleEditor = lazy(loadPageComponentStyleEditor);
export const LazyPageComponentVisualEditor = lazy(loadPageComponentVisualEditor);
export const LazyCustomComponentPropertyEditor = lazy(loadCustomComponentPropertyEditor);

export const LazyReportBuilder = lazy(loadReportBuilder);
