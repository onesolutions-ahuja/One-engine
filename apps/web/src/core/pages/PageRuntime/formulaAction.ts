/** Action formulas run only as the page's converted code (page code). These helpers are
 * what the runtimes still share: assignment parsing and one clear error when an action
 * has no converted code. There is no second formula engine to fall back to. */
import {parseActionFormulaAssignment} from '../../../../../server/src/page-compiler/pageCompilerSupport.js';
export type {ActionFormulaAssignment} from '../../../../../server/src/page-compiler/pageCompilerSupport.js';
export {parseActionFormulaAssignment};

export const NOT_CONVERTED='This action formula is not converted to page code. Open the page in the Page Builder and save it again.';
export function notConvertedAction():never{
 throw new Error(NOT_CONVERTED);
}
