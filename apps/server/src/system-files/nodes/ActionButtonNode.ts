import {executeFlowAction} from '../flow-action-runtime.js';
/** Adapter for metadata-authored Action elements invoked by UI buttons or Flows.
 * Authorization, transactional savepoints and fault routing remain in the shared Action runtime.
 */
export async function executeActionButtonNode(context:Parameters<typeof executeFlowAction>[0]):Promise<number|undefined>{
 return executeFlowAction(context);
}
