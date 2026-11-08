import * as React from 'react';
import {
type ObjectMetadata, type ProfileMetadata, type FlowDefinitionMetadata, type LightningPageMetadata,
type PageLayoutVariant, type LibraryComponentMetadata, type DashboardMetadata, type ReportMetadata,
type LightningAppMetadata,
} from '../../../metadata/Definitions/metadata';

export type PageBuilderProps = {
  page: LightningPageMetadata;
  pages: LightningPageMetadata[];
  objects: ObjectMetadata[];
  apps: LightningAppMetadata[];
  profiles: ProfileMetadata[];
  reports: ReportMetadata[];
  dashboards: DashboardMetadata[];
  libraryComponents: LibraryComponentMetadata[];
  flows: FlowDefinitionMetadata[];
  onChange: (page: LightningPageMetadata) => void;
  onSelectPage: (apiName: string) => void;
  onTargetObjectChange: (targetObject: string) => void;
  onSave: (page: LightningPageMetadata, previousApiName: string, successMessage?: string) => Promise<LightningPageMetadata | false>;
  onPublish: (apiName:string,variant:'Mobile'|'Desktop'|'Tablet'|'Custom',draftRevision?:number)=>Promise<boolean>;
  onDeactivate: (apiName:string)=>Promise<boolean>;
  onSaveApp: (app: LightningAppMetadata, updating: boolean) => Promise<void>;
  onUpdatePageDetails: (apiName:string,label:string,appApiName:string|null,expectedLabel:string,nextApiName?:string,
    devices?:LightningPageMetadata['devices'],expectedDevices?:LightningPageMetadata['devices'])=>Promise<boolean>;
  onDeleteApp: (apiName: string) => Promise<void>;
  onDeletePage: (apiName: string) => Promise<void>;
  onExit: () => void;
  onNotify: (message: string) => void;
  onLaunchFlow: (flowApiName: string, inputs?: Record<string, unknown>) => void;
  preparedAppId: string;
  onPrepareApp: (pageApiName: string, appId: string) => void;
  onAppLinked: (pageApiName: string) => void;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  canManageRoutes: boolean;
  editorMode: boolean;
  onBackToPages: () => void;
  /** Record Page administration lives under Object Manager, never the global Page Builder. */
  recordPageContext?: string;
  /** Initial device layout from an Object Manager deep link. */
  initialLayoutVariant?: PageLayoutVariant;
  /** apiName is given when opening another page's layout (e.g. from the page list). */
  onLayoutVariantChange?: (variant:PageLayoutVariant,apiName?:string) => void;
};

export interface PageBuilderComponents {
  MetadataComponentProperties: React.ComponentType<any>;
  MetadataBoundPageComponent: React.ComponentType<any>;
  LightningAppRuntime: React.ComponentType<any>;
}
export type CanvasSelectionSnapshot = { selectedId: string; selectionIds: string[] };
export type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type RecordListSetting={columns?:string[];pageSize?:10|25|50;showNewAction?:boolean;showRowActions?:boolean;sortField?:string;sortDirection?:'asc'|'desc'};
export type TemplateResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
