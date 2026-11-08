import type { ObjectMetadata } from '../../metadata/Definitions/metadata';
import { loadedMentionContext, type MentionContext } from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';

type DataRecord = Record<string, unknown>;

/**
 * Dashboards display collections by default: never pick records[0] as the source
 * of a scalar @ mention. An explicit recordId or an unambiguous one-record data
 * context is needed. Related records must already be returned by authorised APIs.
 */
export function dashboardMentionContext(
  objects: readonly ObjectMetadata[], root: string,
  recordsByObject: Readonly<Record<string, readonly DataRecord[]>>,
  mentionProperties: Readonly<Record<string, unknown>>, explicitRecordId = ''
): MentionContext {
  const records = recordsByObject[root] ?? [];
  const record = explicitRecordId
    ? records.find(item => item.Id === explicitRecordId)
    : records.length === 1 ? records[0] : undefined;
  return loadedMentionContext(objects, root, record, recordsByObject, mentionProperties);
}

/** Escape resolved values before interpolation into sandboxed rich-text HTML. */
export function htmlSafeMentionContext(context: MentionContext): MentionContext {
  const escape = (value: string) => value.replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[char]);
  return { fields: context.fields, records: Object.fromEntries(
    Object.entries(context.records).map(([path, record]) =>
      [path, record ? Object.fromEntries(Object.entries(record).map(([key, value]) =>
        [key, typeof value === 'string' ? escape(value) : value])) : undefined])
  ) };
}
