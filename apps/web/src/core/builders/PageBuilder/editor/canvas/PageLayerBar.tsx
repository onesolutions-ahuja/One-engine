import { Plus } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { coEditorsStore } from '../management/pageCoEditing';
import type { PageComponentMetadata } from '../../../../metadata/Definitions/metadata';
import { MAX_PAGE_LAYER, componentLayer, layerCaption, pageLayerNumbers } from '../../../../pages/PageRuntime/pageLayers';
import './PageLayerBar.css';

/** Layers tab bar under the canvas: each layer is a separate blank screen of the same page
 * (like slides). Pick the layer to design, + adds the next one, and the selected component
 * can be moved to another layer. The page opens on layer 0. */
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
  // Co-editing: who else is designing this page, and what they have selected (outlined).
  const editors = useSyncExternalStore(coEditorsStore.subscribe, coEditorsStore.get, coEditorsStore.get);
  const colors = ['#E8590C', '#7048E8', '#0CA678', '#D6336C', '#1C7ED6'];
  const outline = editors.flatMap((editor, index) => editor.selection.filter(id => /^[A-Za-z0-9_-]+$/.test(id))
    .map(id => '[data-component-id="' + id + '"]{outline:2px dashed ' + colors[index % colors.length] + ';outline-offset:2px}')).join('');
  return <nav className="page-layer-bar" aria-label="Page layers">
    <span className="page-layer-bar-title">Layers</span>
    <div className="page-layer-bar-tabs" role="tablist">
      {layers.map(layer => {
        const caption = layerCaption(layer);
        return <button key={layer} type="button" role="tab" aria-selected={layer === current}
          className={'page-layer-tab' + (layer === current ? ' is-current' : '')}
          title={layer === 0 ? 'Layer 0: the screen the page opens on' : 'Layer ' + layer + ': a separate screen, shown instead of the others with SCREEN(page, ' + layer + ')'}
          onClick={() => onPick(layer)}>
          <b>{layer}</b>{caption && <span>{caption}</span>}
        </button>;
      })}
      {next <= MAX_PAGE_LAYER && <button type="button" className="page-layer-add" aria-label={'Add layer ' + next}
        title={'Add layer ' + next} onClick={() => onAdd(next)}><Plus size={15} /></button>}
    </div>
    {editors.length > 0 && <span className="page-layer-editors" aria-label="Also designing this page">
      {editors.map((editor, index) => <span key={editor.clientId} className="page-layer-editor"
        style={{ background: colors[index % colors.length] }} title={editor.name + ' is designing this page'}>
        {(editor.name || '?').slice(0, 1).toUpperCase()}</span>)}
      <style>{outline}</style>
    </span>}
    {selected && topLevel && <label className="page-layer-move">
      <span>{String(selected.properties?.navigatorName ?? selected.label)} is on layer</span>
      <select aria-label="Layer of the selected component" value={componentLayer(selected, components)}
        onChange={event => onMove(selected, Number(event.target.value))}>
        {layers.map(layer => <option key={layer} value={layer}>{layer}</option>)}
      </select>
    </label>}
  </nav>;
}
