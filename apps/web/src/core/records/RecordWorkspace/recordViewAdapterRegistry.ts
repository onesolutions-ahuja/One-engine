import {buildChatterView} from './chatterRecordAdapter';

/** Registered read-model adapters operate only on records already authorised by OneEngine.
 * A page chooses its adapter using metadata; presentation components make no network calls.
 */
const adapters: Record<string, (rows: ReadonlyArray<Record<string, unknown>>, properties:Record<string,unknown>) => Record<string, unknown>> = {
  ConversationThread: buildChatterView,
  Chatter: buildChatterView // Existing published adapter key; uses the same generic mapping.
};

export function applyRecordViewAdapter(properties: Record<string, unknown>): Record<string, unknown> {
  const name = typeof properties.recordViewAdapter === 'string' ? properties.recordViewAdapter : '';
  if (!name) return properties;
  const adapter = Object.hasOwn(adapters, name) ? adapters[name] : undefined;
  if (!adapter || !Array.isArray(properties.records)) return properties;
  return {...properties, ...adapter(properties.records as Record<string, unknown>[],properties)};
}
