import type { FieldMetadata } from '../../metadata/Definitions/metadata';

export type RecordFilterOperator = 'Equals' | 'Not Equals' | 'Contains' | 'Greater Than'
  | 'Greater Than or Equal' | 'Less Than' | 'Less Than or Equal' | 'Is Blank' | 'Is Not Blank'
  | 'Includes' | 'Excludes';
export type RecordFilterField = Pick<FieldMetadata, 'apiName' | 'label' | 'dataType' | 'picklistValues'>;
export type RecordFilterValue = { field: string; operator: string; value: unknown };
const operators: RecordFilterOperator[] = ['Equals', 'Not Equals', 'Contains', 'Greater Than',
  'Greater Than or Equal', 'Less Than', 'Less Than or Equal', 'Is Blank', 'Is Not Blank',
  'Includes','Excludes'];
function formulaReturnType(dataType:string):string{
  const formula=/^Formula\((.+)\)$/i.exec(dataType.trim());
  return formula?.[1].trim()??dataType;
}

export function isNumericFilterField(field?: RecordFilterField): boolean {
  return /^(Number|Currency|Percent|Integer|Decimal|Double)(\(|$)/i.test(formulaReturnType(field?.dataType ?? ''));
}
export function isBooleanFilterField(field?: RecordFilterField): boolean {
  return /^(Checkbox|Boolean)$/i.test(formulaReturnType(field?.dataType ?? ''));
}
/** Matches the operators currently implemented by the shared page-data runtime. */
export function supportedFilterOperators(field?: RecordFilterField): RecordFilterOperator[] {
  if (!field) return [...operators];
  if (isNumericFilterField(field)) return ['Equals', 'Not Equals', 'Greater Than',
    'Greater Than or Equal', 'Less Than', 'Less Than or Equal', 'Is Blank', 'Is Not Blank'];
  if (isBooleanFilterField(field)) {
    return ['Equals', 'Not Equals'];
  }
  const dataType=formulaReturnType(field.dataType);
  if (/^(Date|Date\/Time|DateTime)(\(|$)/i.test(dataType)) {
    return ['Equals', 'Not Equals', 'Greater Than', 'Greater Than or Equal',
      'Less Than', 'Less Than or Equal', 'Is Blank', 'Is Not Blank'];
  }
  if (/^Time(\(|$)/i.test(dataType))
    return ['Equals','Not Equals','Greater Than','Greater Than or Equal',
      'Less Than','Less Than or Equal','Is Blank','Is Not Blank'];
  if (/^(Multi-Select Picklist|Multipicklist)$/i.test(dataType))
    return ['Equals','Not Equals','Includes','Excludes','Is Blank','Is Not Blank'];
  return ['Equals', 'Not Equals', 'Contains', 'Is Blank', 'Is Not Blank'];
}
export function examineRecordFilter(raw: unknown, fields: ReadonlyArray<RecordFilterField>): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Invalid saved filter. Remove and re-create it.';
  const filter = raw as Partial<RecordFilterValue>;
  if (typeof filter.field !== 'string' || filter.field === '') return 'Choose a field.';
  const field = fields.find(candidate => candidate.apiName === filter.field);
  if (!field) return 'This field is unavailable in the selected data object.';
  if (!supportedFilterOperators(field).includes(filter.operator as RecordFilterOperator)) {
    return 'This operator is not supported for the selected field type.';
  }
  if (filter.operator === 'Is Blank' || filter.operator === 'Is Not Blank') return null;
  if (filter.value && typeof filter.value === 'object' && !Array.isArray(filter.value)) {
    const source = filter.value as Record<string,unknown>;
    if (source.source === 'PageState') {
      if (typeof source.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(source.key))
        return 'Enter a Page State key (for example categoryId).';
      if (source.skipWhenBlank !== undefined && typeof source.skipWhenBlank !== 'boolean')
        return 'Invalid optional Page State setting.';
      return null;
    }
    if(source.source==='CollectionState'){
      if(typeof source.key!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,79}\.state\.(Id|Name|Value|Field|Criteria)$/.test(source.key))
        return 'Choose a named Collection State value.';
      if(source.skipWhenBlank!==undefined&&typeof source.skipWhenBlank!=='boolean'
        ||source.allWhenStar!==undefined&&typeof source.allWhenStar!=='boolean')
        return 'Invalid Collection State selection option.';
      return null;
    }
    if(source.source==='FieldExpression' && typeof source.key==='string'){
      const ref=source.key;
      const direct=/^@[A-Za-z][A-Za-z0-9_]*$/.test(ref)
        && fields.some(item=>item.apiName===ref.slice(1));
      const related=/^@[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){2,4}$/.test(ref)
        && fields.some(item=>item.apiName===ref);
      return direct||related?null:'Choose an accessible field or related-field reference.';
    }
    if (source.source === 'CurrentRecord' || source.source === 'Session') return null;
    return 'Choose a valid dynamic filter source.';
  }
  const value = String(filter.value ?? '');
  if (isBooleanFilterField(field) && !['true', 'false'].includes(value)) return 'Choose True or False.';
  if (/^(Picklist|Multi-Select Picklist|Multipicklist)$/i.test(field.dataType)) {
    if (!field.picklistValues?.length) return 'This picklist has no available options.';
    if (!field.picklistValues.includes(value)) return 'Choose a value from the field picklist.';
  }
  if (isNumericFilterField(field) && (value.trim() === '' || !Number.isFinite(Number(value)))) {
    return 'Enter a finite numeric filter value.';
  }
  return null;
}
