/** An action with no converted code: one clear error (there is no other action engine). */
export const NOT_CONVERTED='This action formula is not converted to page code. Open the page in the Page Builder and save it again.';
export function notConvertedAction():never{
 throw new Error(NOT_CONVERTED);
}
