import { useEffect, useState } from 'react';
import type { ObjectMetadata } from '../../metadata/Definitions/metadata';
import { loadMentionContext, type MentionContext } from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';

type DataRecord = Record<string, unknown>;
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function explicitMentionRecordId(properties: Readonly<Record<string, unknown>>): string {
  if (typeof properties.recordId === 'string' && properties.recordId.trim()) return properties.recordId.trim();
  // An exact Id filter identifies a record without choosing the first of a list.
  const filters = properties.filters;
  if (!Array.isArray(filters)) return '';
  const matches = filters.filter(item => item && typeof item === 'object' &&
    item.field === 'Id' && (item.operator === 'Equals' || item.operator === 'Equal') &&
    typeof item.value === 'string' && item.value.length);
  return matches.length === 1 ? String(matches[0].value) : '';
}

/**
 * Each fetch goes through the existing authenticated Object API.
 * Never infer a root record from records[0]; anonymous app pages have no active record.
 * Missing access, deleted parent or missing lookup returns no data, not another customer's data.
 */
export function useRelationshipMentionContext(
  objects: readonly ObjectMetadata[], root: string, recordId: string,
  properties: Readonly<Record<string, unknown>>, apiRequest: Request, revision = 0
): MentionContext {
  const [context, setContext] = useState<MentionContext>({ records: {}, fields: {} });
  useEffect(() => {
    let active = true;
    setContext({ records: {}, fields: {} });
    if (!root || !recordId || recordId.length > 256 || !objects.some(object => object.apiName === root)) {
      return () => { active = false; };
    }
    const getRecord = async (objectApiName: string, id: string): Promise<DataRecord | undefined> => {
      const result = await apiRequest<{ record: DataRecord }>(
        '/records/' + encodeURIComponent(objectApiName) + '/' + encodeURIComponent(id));
      return result.record && result.record.Id === id ? result.record : undefined;
    };
    void getRecord(root, recordId)
      .then(record => loadMentionContext(objects, root, record, properties, getRecord))
      .then(value => { if (active) setContext(value); })
      .catch(() => { if (active) setContext({ records: {}, fields: {} }); });
    return () => { active = false; };
  }, [objects, root, recordId, properties, apiRequest, revision]);
  return context;
}
