import assert from 'node:assert/strict';

/** Browser regression for the shared Formula Bar's autocomplete/argument help. */
export async function checkFormulaTooltipPlacement({page,formulaInput}){
 // The two types of help must form ONE popup below the input, not cover the caret.
 await formulaInput.fill('=COLLECTION("Menu", EX');
 const suggestionPopup=page.getByRole('listbox',{name:'Formula functions'});
 await suggestionPopup.waitFor({state:'visible'});
 const nestedHelp=suggestionPopup.getByRole('status',{name:'Formula argument help'});
 await nestedHelp.waitFor({state:'visible'});
 const formulaBounds=await formulaInput.boundingBox();
 const suggestionBounds=await suggestionPopup.boundingBox();
 const nestedHelpBounds=await nestedHelp.boundingBox();
 assert.ok(formulaBounds&&suggestionBounds&&nestedHelpBounds);
 assert.ok(suggestionBounds.y>=formulaBounds.y+formulaBounds.height+2,
  'Autocomplete must open below, never in front of, the Formula Bar');
 assert.ok(nestedHelpBounds.y>=formulaBounds.y+formulaBounds.height+2,
  'Function signature must appear inside the dropdown below the typing caret');
 assert.equal(await page.locator('body > .smart-formula-signature').count(),0,
  'Nested autocomplete must not create a second floating tooltip over the Formula Bar');
 assert.equal(await formulaInput.inputValue(),'=COLLECTION("Menu", EX',
  'Opening autocomplete must not change the current formula text');

 // With no dropdown suggestions, help stands alone below the same input.
 await formulaInput.fill('=COLLECTION("Menu", ');
 const standaloneHelp=page.locator('body > .smart-formula-signature');
 await standaloneHelp.waitFor({state:'visible'});
 const standaloneBounds=await standaloneHelp.boundingBox();
 assert.ok(standaloneBounds&&standaloneBounds.y>=formulaBounds.y+formulaBounds.height+2,
  'Standalone function help must remain below the Formula Bar');
 await formulaInput.fill('Tab 2');
}
