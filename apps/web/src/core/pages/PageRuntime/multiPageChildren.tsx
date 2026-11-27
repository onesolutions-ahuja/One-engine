import React from 'react';
import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
import {childrenOf, isSelfOrDescendant, multiPageKey, multiPageName, multiPageTabId} from '../TemplatePageRuntime/pageComponentLayout';
import type {ScreenTabRequests} from './multiPageScreens';

/** Smart MultiPage reads which child is which page from these wrappers (display: contents,
 * so layout is unchanged). Other containers get their children untouched.
 * `screenTabs`: tabs SCREEN(page, MultiPage, n) asked for, keyed by MultiPage name (lower case). */
export function multiPageChildren(parent: PageComponentMetadata, children: PageComponentMetadata[],
  nodes: React.ReactNode[], all: PageComponentMetadata[], selectedId?: string | null, openId?: string,
  screenTabs?: ScreenTabRequests): React.ReactNode[] {
  if (parent.type !== 'Custom:smart_multipage') return nodes;
  // Designer: one tab is marked open (the one holding the selection, else openId).
  const open = children.find(child => isSelfOrDescendant(all, child.id, selectedId))?.id ?? openId;
  const tabs = childrenOf(all, parent.id);
  const asked = screenTabs?.[multiPageName(parent).toLowerCase()];
  return children.map((child, index) => <div key={child.id} style={{display: 'contents'}}
    data-page-key={multiPageKey(child)} data-page-label={child.label}
    data-page-icon={typeof child.properties?.pageIcon === 'string' && child.properties.pageIcon ? child.properties.pageIcon : undefined}
    data-page-requested={asked && asked.tab === multiPageTabId(child, tabs) ? String(asked.n) : undefined}
    data-page-selected={child.id === open ? 'true' : undefined}>{nodes[index]}</div>);
}
