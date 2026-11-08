import { useModalAccessibility } from '../../../../accessibility/Modal/useModalAccessibility';
import { useCallback, useRef, useState } from 'react';

export function useFlowCreateDialog() {

  const [showCreateFlow, setShowCreateFlow] = useState(false);
  const createFlowDialog = useRef<HTMLElement>(null);
  const closeCreateFlow = useCallback(() => setShowCreateFlow(false), []);
  useModalAccessibility(showCreateFlow, createFlowDialog, closeCreateFlow);

  return {
    showCreateFlow, setShowCreateFlow, createFlowDialog,
  };
}
