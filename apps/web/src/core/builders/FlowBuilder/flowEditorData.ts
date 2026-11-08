export type ConfigRow = Record<string, unknown>;
export type DecisionOutcome = { name: string; label: string; conditionLogic: string; conditions: ConfigRow[] };

export function rowsFrom(value: unknown): ConfigRow[] {
  return Array.isArray(value)
    ? value.filter((item): item is ConfigRow => typeof item === 'object' && item !== null && !Array.isArray(item))
    : [];
}
export function outcomesFrom(value: unknown): DecisionOutcome[] {
  return rowsFrom(value).map((item, index) => ({
    name: typeof item.name === 'string' ? item.name : `Outcome_${index + 1}`,
    label: typeof item.label === 'string' ? item.label : `Outcome ${index + 1}`,
    conditionLogic: typeof item.conditionLogic === 'string' ? item.conditionLogic : displayValue(rowsFrom(item.conditions)[0]?.logic) || 'All',
    conditions: rowsFrom(item.conditions)
  }));
}

export function screenOutcomesFrom(value: unknown): Array<{ name: string; label: string }> {
  const outcomes = rowsFrom(value).map((item, index) => ({
    name: typeof item.name === 'string' ? item.name : `Outcome_${index + 1}`,
    label: typeof item.label === 'string' ? item.label : `Outcome ${index + 1}`
  }));
  return outcomes.length ? outcomes : [{ name: 'Default', label: 'Next' }];
}

export function displayValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

