// Backward-compatible Flow runtime exports; node implementation lives under nodes/.
export type {FlowDecisionCondition} from './nodes/DecisionNode.js';
export {evaluateFlowDecisionOutcome,evaluateFlowDecisionComparison} from './nodes/DecisionNode.js';
