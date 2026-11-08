import { useEffect, useMemo, useRef, useState } from 'react';
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

const EMPTY_MENTION_CONTEXT: MentionContext = Object.freeze({ records: {}, fields: {} }) as MentionContext;

function isEmptyMentionContext(value: MentionContext): boolean {
  return value === EMPTY_MENTION_CONTEXT ||
    (Object.keys(value.records).length === 0 && Object.keys(value.fields).length === 0);
}

function stablePropertiesKey(properties: Readonly<Record<string, unknown>>): string {
  try { return JSON.stringify(properties) ?? ''; } catch { return 'unserializable'; }
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
  const [context, setContext] = useState<MentionContext>(EMPTY_MENTION_CONTEXT);
  // Callers rebuild `properties` on every render. Depending on its identity re-ran this
  // effect each render, and the reset below then re-rendered again: an endless loop on
  // every component of every page. Key the effect on the content instead.
  const propertiesKey = useMemo(() => stablePropertiesKey(properties), [properties]);
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;
  useEffect(() => {
    let active = true;
    const properties = propertiesRef.current;
    // Functional reset keeps the same object when already empty, so no extra render.
    setContext(previous => isEmptyMentionContext(previous) ? previous : EMPTY_MENTION_CONTEXT);
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
      .catch(() => { if (active) setContext(EMPTY_MENTION_CONTEXT); });
    return () => { active = false; };
  }, [objects, root, recordId, propertiesKey, apiRequest, revision]);
  return context;
}
