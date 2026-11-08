import {getFormulaFunctionNames} from '../../../../../server/src/expression-engine/FormulaFunctionRegistry.js';

export const formulaFunctions=getFormulaFunctionNames('flow_formula');
export const formulaOperators = ['+', '-', '*', '/', '^', '&', '=', '<>', '!=', '<', '<=', '>', '>=', 'AND', 'OR'];
