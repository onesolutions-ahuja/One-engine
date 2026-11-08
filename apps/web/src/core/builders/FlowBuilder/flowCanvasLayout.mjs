// Flow Builder canvas geometry is authoring metadata. It never executes as
// business logic and does not change the compiled Flow execution graph.
const MAX_POSITION = 12_000;
const MIN_POSITION = 0;
export const FLOW_NODE_WIDTH = 320;
export const FLOW_NODE_HEIGHT = 80;
export const FLOW_GRAPH_PADDING = 56;

const coordinate = (value) => typeof value === 'number' && Number.isFinite(value)
  && value >= MIN_POSITION && value <= MAX_POSITION;

export function storedFlowPosition(element, fallback) {
  const saved = element?.config?.canvasPosition;
  if (saved && typeof saved === 'object' && !Array.isArray(saved)
    && coordinate(saved.x) && coordinate(saved.y)) {
    return { x: saved.x, y: saved.y };
  }
  return { x: fallback.x, y: fallback.y };
}

export function moveFlowPosition(position, deltaX, deltaY, zoom = 1) {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)
    || !Number.isFinite(zoom) || zoom <= 0) {
    throw new Error('Invalid Flow canvas movement');
  }
  const clamp = (n) => Math.min(MAX_POSITION, Math.max(MIN_POSITION, Math.round(n)));
  return { x: clamp(position.x + deltaX / zoom), y: clamp(position.y + deltaY / zoom) };
}

export function flowCanvasBounds(positions, minimumWidth, minimumHeight) {
  const points = [...positions.values()];
  return {
    width: Math.max(minimumWidth, FLOW_GRAPH_PADDING * 2,
      ...points.map(point => point.x + FLOW_NODE_WIDTH + FLOW_GRAPH_PADDING)),
    height: Math.max(minimumHeight, FLOW_GRAPH_PADDING * 2,
      ...points.map(point => point.y + FLOW_NODE_HEIGHT + FLOW_GRAPH_PADDING))
  };
}
