/**
 * Insert an element on an existing Flow connector without changing its
 * outcome/fault/scheduled/async semantics. Flow execution follows connectors,
 * not the order in the editor's elements array.
 *
 * Ambiguous branches deliberately fail closed. The caller must select the
 * specific connector to split rather than silently rewiring a Decision.
 */
export function insertFlowElementAtPath(flow, fromId, element, connectorId, continuationId) {
  const previousIndex = flow.elements.findIndex(item => item.id === fromId);
  if (previousIndex < 0) throw Error('Select a valid Flow element before adding another.');
  if (flow.elements.some(item => item.id === element.id)) throw Error('Flow element IDs must be unique.');
  if (flow.elements[previousIndex].type === 'End') throw Error('Cannot add after an End element.');
  const outgoing = flow.connectors.filter(connector => connector.from === fromId);
  if (outgoing.some(connector => !flow.elements.some(item => item.id === connector.to))) {
    throw Error('Cannot insert on a path with a missing destination element.');
  }
  if (new Set(outgoing.map(connector => connector.id)).size !== outgoing.length) {
    throw Error('Cannot insert on a path with duplicate connector IDs.');
  }
  const selected = connectorId
    ? outgoing.find(connector => connector.id === connectorId)
    : outgoing.length === 1 ? outgoing[0] : undefined;
  if (connectorId && !selected) throw Error('Selected Flow connector no longer belongs to this element.');
  if (!connectorId && outgoing.length > 1) {
    throw Error('Select an outcome path before inserting an element on a branching Flow.');
  }
  if (element.type === 'End' && selected) {
    throw Error('End must terminate a path. Select a step without an outgoing connector, or remove the existing continuation first.');
  }
  if (!continuationId || flow.connectors.some(connector => connector.id === continuationId)) {
    throw Error('New Flow connector ID must be unique.');
  }
  const outcomes = element.type === 'Decision'
    ? decisionOutcomeLabels(element.config?.outcomes)
    : element.type === 'Orchestration Stage' ? ['Approved','Rejected'] : [];
  const needsTerminal = outcomes.length > 0 && !selected;
  const terminalId = needsTerminal
    ? Math.max(element.id, ...flow.elements.map(item => item.id)) + 1
    : null;
  const elements = [
    ...flow.elements.slice(0, previousIndex + 1),
    element,
    ...(needsTerminal ? [{ id: terminalId, type: 'End', label: 'End', config: {} }] : []),
    ...flow.elements.slice(previousIndex + 1)
  ];
  if (!selected) {
    const first = { id: continuationId, from: fromId, to: element.id, label: '', kind: 'normal' };
    const branches = needsTerminal ? outcomes.map((label, index) => ({
      id: continuationId + '-outcome-' + index,
      from: element.id, to: terminalId, label, kind: 'normal'
    })) : [];
    if (branches.some(item => flow.connectors.some(existing => existing.id === item.id)))
      throw Error('New Flow connector ID must be unique.');
    return { ...flow, elements, connectors: [...flow.connectors, first, ...branches] };
  }
  const connectorIndex = flow.connectors.findIndex(connector => connector.id === selected.id);
  const continuations = outcomes.length ? outcomes.map((label, index) => ({
    id: continuationId + '-outcome-' + index,
    from: element.id, to: selected.to, label, kind: 'normal'
  })) : [{ id: continuationId, from: element.id, to: selected.to, label: '', kind: 'normal' }];
  if (continuations.some(item => flow.connectors.some(existing => existing.id === item.id)))
    throw Error('New Flow connector ID must be unique.');
  const connectors = [
    ...flow.connectors.slice(0, connectorIndex),
    { ...selected, to: element.id },
    ...continuations,
    ...flow.connectors.slice(connectorIndex + 1)
  ];
  return { ...flow, elements, connectors };
}

/** Default is the runtime's special fallback outcome; named outcomes use their visible labels. */
export function decisionOutcomeLabels(outcomes) {
  if (!Array.isArray(outcomes)) return ['Default'];
  const labels = outcomes.map(item => item?.name === 'Default' ? 'Default' : item?.label || item?.name)
    .filter(label => typeof label === 'string' && label.trim());
  if (!labels.includes('Default')) labels.push('Default');
  if (new Set(labels).size !== labels.length) throw Error('Decision outcomes require unique labels.');
  return labels;
}

/** Reconcile Decision outcomes without replacing existing configured branch destinations. */
export function reconcileDecisionOutcomePaths(flow, decisionId, nextOutcomes, connectorPrefix) {
  const node = flow.elements.find(item => item.id === decisionId);
  if (!node || node.type !== 'Decision') throw Error('Choose a Decision element.');
  const old = Array.isArray(node.config?.outcomes) ? node.config.outcomes : [];
  const oldLabels = decisionOutcomeLabels(old);
  const nextLabels = decisionOutcomeLabels(nextOutcomes);
  const normal = flow.connectors.filter(item => item.from === decisionId && item.kind === 'normal');
  const kept = new Set();
  const connectors = [...flow.connectors];
  // Match unchanged outcome names first, then rename a single unmatched outcome in place.
  for (const label of nextLabels) {
    const found = normal.find(edge => edge.label === label && !kept.has(edge.id));
    if (found) kept.add(found.id);
  }
  const removed = oldLabels.filter(label => !nextLabels.includes(label) && label !== 'Default');
  const added = nextLabels.filter(label => !oldLabels.includes(label) && label !== 'Default');
  if (removed.length === 1 && added.length === 1) {
    const renamed = normal.find(edge => edge.label === removed[0] && !kept.has(edge.id));
    if (renamed) {
      connectors[connectors.findIndex(edge => edge.id === renamed.id)] = { ...renamed, label: added[0] };
      kept.add(renamed.id);
    }
  }
  const active = new Set(nextLabels);
  let updated = connectors.filter(edge => edge.from !== decisionId || edge.kind !== 'normal'
    || active.has(edge.label));
  const linked = new Set(updated.filter(edge => edge.from === decisionId && edge.kind === 'normal')
    .map(edge => edge.label));
  const missing = nextLabels.filter(label => !linked.has(label));
  let elements = flow.elements.map(item => item.id === decisionId
    ? { ...item, config: { ...item.config, outcomes: nextOutcomes } } : item);
  if (missing.length) {
    let end = elements.find(item => item.type === 'End');
    if (!end) {
      end = { id: Math.max(...elements.map(item => item.id), 0) + 1, type: 'End', label: 'End', config: {} };
      elements = [...elements, end];
    }
    const ids = new Set(updated.map(item => item.id));
    for (let index = 0; index < missing.length; index++) {
      const label = missing[index];
      let id = connectorPrefix + '-' + index;
      while (ids.has(id)) id += '-next';
      ids.add(id);
      updated.push({ id, from: decisionId, to: end.id, label, kind: 'normal' });
    }
  }
  return { ...flow, elements, connectors: updated };
}

/**
 * Explicit, non-destructive repair for legacy Draft graphs made before Start -> End
 * defaults existed. Existing nodes and valid connector targets are never removed.
 */
export function completeFlowEndPaths(flow, connectorPrefix) {
  if (!flow || !Array.isArray(flow.elements) || !Array.isArray(flow.connectors))
    throw Error('Invalid Flow graph.');
  if (flow.status === 'Active') throw Error('Create a draft version before editing an active Flow.');
  let elements = [...flow.elements];
  const connectors = [...flow.connectors];
  const nextId = () => Math.max(0, ...elements.map(item => item.id)) + 1;
  let terminal = elements.find(item => item.type === 'End');
  const getEnd = () => {
    if (!terminal) {
      terminal = { id: nextId(), type: 'End', label: 'End', config: {} };
      elements.push(terminal);
    }
    return terminal.id;
  };
  const used = new Set(connectors.map(item => item.id));
  const link = (from, label) => {
    let id = connectorPrefix + '-' + connectors.length;
    while (used.has(id)) id += '-next';
    used.add(id);
    connectors.push({ id, from, to: getEnd(), label, kind: 'normal' });
  };
  for (const node of flow.elements) {
    if (node.type === 'End') continue;
    const paths = connectors.filter(edge => edge.from === node.id && edge.kind === 'normal');
    if (node.type === 'Decision') {
      const labels = decisionOutcomeLabels(node.config?.outcomes);
      // Reuse an unlabeled default connector without rewiring its target.
      const defaultEdge = paths.find(edge => !edge.label);
      if (defaultEdge && !paths.some(edge => edge.label === 'Default'))
        connectors[connectors.findIndex(edge => edge.id === defaultEdge.id)] = { ...defaultEdge, label: 'Default' };
      const current = new Set(connectors.filter(edge => edge.from === node.id && edge.kind === 'normal').map(edge => edge.label));
      for (const label of labels) if (!current.has(label)) link(node.id, label);
    } else if(node.type === 'Orchestration Stage') {
      const current=new Set(paths.map(edge=>edge.label));
      for(const label of ['Approved','Rejected'])if(!current.has(label))link(node.id,label);
    } else if (!paths.length) {
      link(node.id, '');
    }
  }
  return { ...flow, elements, connectors };
}
