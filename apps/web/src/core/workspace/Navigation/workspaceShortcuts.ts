/** Shared workspace shortcuts. No app-specific CRUD logic or permission bypass.
 * All actions go through the existing routed UI, whose commands enforce RBAC.
 */
export type WorkspaceShortcut = 'back'|'forward'|'sidebar'|'find'|'new'|'help'|null;

export function workspaceShortcut(event: Pick<KeyboardEvent,'key'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'>, typing=false): WorkspaceShortcut {
  if (typing || event.altKey || event.shiftKey) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command) {
    if (event.key === '[') return 'back';
    if (event.key === ']') return 'forward';
    if (event.key === '\\') return 'sidebar';
    if (event.key.toLowerCase() === 'f') return 'find';
    if (event.key.toLowerCase() === 'n') return 'new';
    return null; // Cmd+K belongs to the existing GlobalRecordSearch.
  }
  return event.key === '?' ? 'help' : null;
}

export function isTypingShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"]'
  ));
}
