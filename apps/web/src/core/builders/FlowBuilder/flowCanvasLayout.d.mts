export type FlowCanvasPosition = { x: number; y: number };
export const FLOW_NODE_WIDTH: number;
export const FLOW_NODE_HEIGHT: number;
export const FLOW_GRAPH_PADDING: number;
export function storedFlowPosition(element: { config?: Record<string, unknown> }, fallback: FlowCanvasPosition): FlowCanvasPosition;
export function moveFlowPosition(position: FlowCanvasPosition, deltaX: number, deltaY: number, zoom?: number): FlowCanvasPosition;
export function flowCanvasBounds(positions: Map<number, FlowCanvasPosition>, minimumWidth: number, minimumHeight: number): { width: number; height: number };
