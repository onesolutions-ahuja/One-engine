import React from 'react';
import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
import {isSelfOrDescendant, multiPageKey} from '../TemplatePageRuntime/pageComponentLayout';

/** Smart MultiPage reads which child is which page from these wrappers (display: contents,
 * so layout is unchanged). Other containers get their children untouched. */
export function multiPageChildren(parent: PageComponentMetadata, children: PageComponentMetadata[],
  nodes: React.ReactNode[], all: PageComponentMetadata[], selectedId?: string | null, openId?: string): React.ReactNode[] {
  if (parent.type !== 'Custom:smart_multipage') return nodes;
  // Designer: one tab is marked open (the one holding the selection, else openId).
  const open = children.find(child => isSelfOrDescendant(all, child.id, selectedId))?.id ?? openId;
  return children.map((child, index) => <div key={child.id} style={{display: 'contents'}}
    data-page-key={multiPageKey(child)} data-page-label={child.label}
    data-page-selected={child.id === open ? 'true' : undefined}>{nodes[index]}</div>);
}
