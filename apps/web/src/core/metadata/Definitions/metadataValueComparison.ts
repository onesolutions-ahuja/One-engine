/** Shared, side-effect-free comparison for metadata record filters and visibility rules.
 * Validity, read permissions and field presence are checked by callers.
 * Preserve the existing locale-specific Contains behaviour for record filters.
 */
export function compareMetadataValue(
  actual: unknown, operator: string, expected: unknown, localeCase = false
): boolean {
  const blank = actual === null || actual === undefined || actual === '';
  if (operator === 'Is Blank') return blank;
  if (operator === 'Is Not Blank') return !blank;
  if (actual === null || actual === undefined) return false;
  const left = String(actual);
  const right = String(expected ?? '');
  switch (operator) {
    case 'Equals': return left === right;
    case 'Not Equals': return left !== right;
    case 'Contains': return localeCase
      ? left.toLocaleLowerCase().includes(right.toLocaleLowerCase())
      : left.toLowerCase().includes(right.toLowerCase());
    case 'Includes':
      return right.split(';').every(value=>left.split(';').includes(value));
    case 'Excludes':
      return !right.split(';').every(value=>left.split(';').includes(value));
    case 'Greater Than':
    case 'Greater Than or Equal':
    case 'Less Than':
    case 'Less Than or Equal': {
      const numericLeft = Number(actual);
      const numericRight = Number(right);
      let leftValue = numericLeft;
      let rightValue = numericRight;
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
        const isoDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
        const isoTime = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/;
        if (typeof actual !== 'string' || typeof expected !== 'string'
          || !(isoDate.test(actual) && isoDate.test(expected))
            && !(isoTime.test(actual) && isoTime.test(expected))) return false;
        leftValue = isoTime.test(actual) ? Date.parse(`1970-01-01T${actual}Z`) : Date.parse(actual);
        rightValue = isoTime.test(expected) ? Date.parse(`1970-01-01T${expected}Z`) : Date.parse(expected);
        if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return false;
      }
      if (operator === 'Greater Than') return leftValue > rightValue;
      if (operator === 'Greater Than or Equal') return leftValue >= rightValue;
      if (operator === 'Less Than') return leftValue < rightValue;
      return leftValue <= rightValue;
    }
    default: return false;
  }
}
