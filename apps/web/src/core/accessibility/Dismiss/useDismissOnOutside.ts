import * as React from 'react';
import { useDismissOnOutside as sharedDismissOnOutside } from '../../../component-libraries/shared/accessibilityHooks';

export function useDismissOnOutside<T extends HTMLElement>(
  container: React.RefObject<T>, expanded: boolean, dismiss: () => void
) {
  sharedDismissOnOutside(React, container, expanded, dismiss);
}
