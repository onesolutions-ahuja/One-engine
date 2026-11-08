import type { FlowDefinitionMetadata, FlowElementMetadata } from '../../metadata/Definitions/metadata';
export function insertFlowElementAtPath(flow: FlowDefinitionMetadata, fromId: number, element: FlowElementMetadata, connectorId: string | undefined, continuationId: string): FlowDefinitionMetadata;
export function decisionOutcomeLabels(outcomes: unknown): string[];
export function reconcileDecisionOutcomePaths(flow: FlowDefinitionMetadata, decisionId: number, nextOutcomes: unknown[], connectorPrefix: string): FlowDefinitionMetadata;
export function completeFlowEndPaths(flow: FlowDefinitionMetadata, connectorPrefix: string): FlowDefinitionMetadata;
