import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/core/pages/TemplatePageRuntime/pageComponentAppearance.css',import.meta.url),'utf8');

test('Card Body fill colours each card, never the Grid background between cards',()=>{
 // Card Body fill/border/radius/shadow are the component's own backgroundColor/borderColor/radius/shadow.
 // For Smart Card Grid and Smart ID Card they must not paint the .smart-grid surface, or the
 // space between cards takes the card colour and Grid background (gridBackgroundColor) is hidden.
 for(const key of ['background','stroke','border','shadow','radius']){
  const rule=`[data-page-appearance="collection"][data-page-style~="${key}"] .registered-component`;
  assert.ok(!css.includes(rule+' .smart-grid,'),key+' still paints every .smart-grid');
  assert.ok(css.includes(rule+':not(.metadrive-component-smart_card_grid,.metadrive-component-smart_id_card) .smart-grid,'),key);
 }
});
