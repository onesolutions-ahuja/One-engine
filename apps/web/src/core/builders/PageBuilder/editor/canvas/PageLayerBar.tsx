import { Plus } from 'lucide-react';
import type { PageComponentMetadata } from '../../../../metadata/Definitions/metadata';
import { MAX_PAGE_LAYER, componentLayer, layerCaption, pageLayerNumbers } from '../../../../pages/PageRuntime/pageLayers';
import './PageLayerBar.css';

/** Layers tab bar under the canvas: pick the layer to design, + adds the next layer, and
 * the selected component can be moved to another layer. Layer 0 is the page itself. */
export default function PageLayerBar({ components, current, added, selected, onPick, onAdd, onMove }: {
  components: readonly PageComponentMetadata[];
  current: number;
  added: readonly number[];
  selected?: PageComponentMetadata;
  onPick: (layer: number) => void;
  onAdd: (layer: number) => void;
  onMove: (component: PageComponentMetadata, layer: number) => void;
}) {
  const layers = [...new Set([...pageLayerNumbers(components), ...added, current])].sort((a, b) => a - b);
  const next = Math.max(...layers) + 1;
  const topLevel = selected && !(selected.properties?.layoutParentId || selected.parentId);
  return <nav className="page-layer-bar" aria-label="Page layers">
    <span className="page-layer-bar-title">Layers</span>
    <div className="page-layer-bar-tabs" role="tablist">
      {layers.map(layer => {
        const caption = layerCaption(layer, components);
        return <button key={layer} type="button" role="tab" aria-selected={layer === current}
          className={'page-layer-tab' + (layer === current ? ' is-current' : '')}
          title={layer === 0 ? 'Layer 0: the page itself, always shown' : 'Layer ' + layer + ': shown over layer 0 when opened with SCREEN(page, ' + layer + ')'}
          onClick={() => onPick(layer)}>
          <b>{layer}</b>{caption && <span>{caption}</span>}
        </button>;
      })}
      {next <= MAX_PAGE_LAYER && <button type="button" className="page-layer-add" aria-label={'Add layer ' + next}
        title={'Add layer ' + next} onClick={() => onAdd(next)}><Plus size={15} /></button>}
    </div>
    {selected && topLevel && <label className="page-layer-move">
      <span>{String(selected.properties?.navigatorName ?? selected.label)} is on layer</span>
      <select aria-label="Layer of the selected component" value={componentLayer(selected, components)}
        onChange={event => onMove(selected, Number(event.target.value))}>
        {layers.map(layer => <option key={layer} value={layer}>{layer}</option>)}
      </select>
    </label>}
  </nav>;
}
