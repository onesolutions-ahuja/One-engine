import * as React from 'react';
import type { RefObject } from 'react';
import { useModalAccessibility as sharedModalAccessibility } from '../../../component-libraries/shared/accessibilityHooks';

/** Shared keyboard and scroll containment for ordinary workspace and One dialogs. */
export function useModalAccessibility<T extends HTMLElement>(
  active: boolean, dialog: RefObject<T>, onEscape: () => void
): void {
  sharedModalAccessibility(React, active, dialog, onEscape);
}
