# Task pack: switch record storage to the native tables and drop `md_record_values`

Owner decision (16 Nov 2026): data is demo data; users, tenants and permissions stay.
Dashboard builder, report builder, webhooks, integration log, mail inbox sync, retention,
tenant inspection, booking/invoice guards and field-TYPE change may be deleted or switched off.

## Rules for every agent (follow exactly)
1. Do ONLY your task's files. Do not refactor, rename or "improve" anything else.
2. Never add a new place that reads or writes `md_record_values`.
3. Use ONLY the helpers from Task 0 to reach record values. Never build table or column
   names yourself; never interpolate user input into SQL (parameters only).
4. Keep every existing permission check (`md_record_access`, `rbac.require`, field checks).
5. One branch per task: `native/<task-letter>-<short-name>`, one PR, base `main`.
   Tasks B, C, D all edit `record-engine.ts`: do them ONE AFTER ANOTHER, never in parallel.
6. Before opening the PR run: `npm run check`, `npm --prefix apps/server test`,
   and the PostgreSQL scripts named in your task (see `.github/workflows/verify-oci-build.yml`,
   job `native-storage-copy`). All must pass. Paste their last lines in the PR.
7. Do not merge. Claude reviews and merges.

## Storage facts (read once)
- Each Object has a table named in `md_native_objects.table_name` (`md_object_<32 hex>`).
  Columns: `tenant_id,id,created_at,updated_at,owner_id,owner_queue_id,record_type_id,is_clone,
  is_deleted,deleted_at,deleted_by,deletion_group_id,deletion_root_id,extras jsonb,present_fields text[]`.
- Field -> storage: `md_native_fields(tenant_id,object_api,field_api,column_name,sql_type,data_type)`.
  `column_name` set = typed column `f_<32 hex>`; NULL = value in `extras->>field_api`.
  `present_fields` lists fields that have a value (NULL vs "never set").
- SQL types: text, numeric, boolean, uuid (lookups), date, timestamptz,
  `double precision[]` (geolocation [lat,lng]), `text[]` (address [street,city,state,postal,country]).
- `md_records` STAYS (one row per record: owner, sharing, deletion). Only `md_record_values` goes.
- Existing helpers: `apps/server/src/system-files/native-object-query.ts`
  (`nativeFieldExpression`, `nativeRecordJoin`, `nativeValuesJoin`) - Task 0 extends this file.

## Task 0 - helpers (do first, alone)
File: `apps/server/src/system-files/native-object-query.ts` (+ new `native-values.ts` beside it).
Add, with unit tests in `apps/server/test/system/native-values.test.ts`:
- `loadNativeFields(executor,tenantId,objectApi)` -> `{table, fields: Map<field_api,{column,sqlType,dataType}>}`
  (one query joining `md_native_objects` + `md_native_fields`; throw `Object has no native table` if missing).
- `nativeValueSql(meta, fieldApi, alias='nr', asText=false)` -> SQL expression (wraps `nativeFieldExpression`).
- `nativeTableSql(meta)` -> quoted table name (validated `^md_object_[a-f0-9]{32}$`).
- `writeNativeValues(client,tenantId,objectApi,recordId,values:Map<field_api,RecordStoredValue>)`:
  ONE `UPDATE <table> SET <col>=$n..., extras=..., present_fields=...` for all fields
  (same conversion rules as SQL `md_native_write_value` in `native-object-storage.ts`; value NULL
  or empty -> remove from `present_fields`). Keep `md_record_multi_values` writes as in
  `record-value-write.ts`.
- `readNativeValueRows(meta, alias)` -> the `nativeValuesJoin` lateral (EAV-shaped rows
  `field_api,value_text,reference_record_id,value_number,value_date,value_datetime,value_boolean,
  geo_latitude,geo_longitude,address_*`) for a record alias `r`.
Done when: tests cover every SQL type, NULL, extras vs column, and an injection attempt in field names.

## Task A - delete/switch off (parallel-safe)
- Delete routes/services and their tests: dashboard builder, report builder, inbound webhooks,
  integration API log, mail inbox sync, record retention, tenant inspection routes.
- `system-files/nodes/RecordAvailabilityGuard.ts`, `RecordOverlapGuard.ts`, `DocumentFinancialGuard.ts`:
  make each guard return "allowed" with a `TODO(native)` comment; remove their `md_record_values` SQL.
- `field-engine/FieldTypeMigration.ts`: changing a field's data type returns 400
  `Changing a field type is switched off for now`; delete its `md_record_values` SQL.
- Remove their entries from `scripts/audit-sql-api-contract.mjs` expectations if the audit fails.
Done when: `npm run check` passes and no file in this list references `md_record_values`.

## Task B - writes (record-engine, first)
File: `system-files/record-engine.ts`, `system-files/record-value-write.ts`.
- Replace every `writeRecordValues(...)` call with `writeNativeValues(...)`.
- Field history (search `Field history: previous values`): read previous values with
  `readNativeValueRows` for that record instead of `md_record_values`.
- Delete paths (`UPDATE md_record_values SET value_text=NULL...`, `record_is_deleted`): drop them;
  deletion state lives in `md_records`/native `is_deleted` (synced by `md_native_record_changed`).
- Restore paths (`UPDATE md_record_values v SET record_is_deleted=false`): drop them likewise.
Done when: `record-trips-probe.mjs`, `native-object-runtime-sql-smoke.mjs`, `search-10k-probe.mjs` pass.

## Task C - reads and filters (record-engine, after B)
File: `system-files/record-engine.ts`.
- Every `LEFT JOIN md_record_values v ...` and `${nativeValuesJoin(...)??...md_record_values...}`:
  use `readNativeValueRows` only (no fallback).
- `EXISTS(SELECT 1 FROM md_record_values fv ...)` filters (search `fv`, `relation`, `sv` sort join):
  replace with predicates on `nr` via `nativeValueSql` and `nativeRecordJoin`.
- Lookup reads (`SELECT reference_record_id FROM md_record_values WHERE ... field_api=$3`):
  `SELECT <nativeValueSql(meta,field)> FROM <table> nr WHERE tenant_id=$1 AND id=$2`.
Done when: same scripts as B pass.

## Task D - required lookups, defaults, owner (record-engine, after C)
Remaining `md_record_values` lines in `record-engine.ts` (search the file): same patterns as C.
Done when: `grep md_record_values apps/server/src/system-files/record-engine.ts` is empty.

## Task E - unique values and search index (SQL, parallel-safe with A)
File: `system-support/native-object-storage.ts` (DDL only).
- In `md_native_configure_field`: when the field is unique (`md_field_definitions.is_unique`),
  create `CREATE UNIQUE INDEX IF NOT EXISTS ... ON <table>(tenant_id, lower(<expr>)) WHERE NOT is_deleted AND <expr> IS NOT NULL`
  (case-sensitive fields: without `lower`). Duplicate value -> error `Value must be unique`.
- Add an AFTER INSERT/UPDATE trigger function on each native table that refreshes
  `md_record_search_values` for that record (copy the logic of `md_record_search_values_sync_trigger`
  from `migrations/20261107-core-baseline.sql`, reading values from the native row).
Done when: a new PostgreSQL script `apps/server/scripts/native-unique-search-smoke.mjs` proves a duplicate
unique value is rejected and search finds a new record; add it to the CI job.

## Task F - Object Manager fields
File: `system-files/object-definition.ts` (lines with `md_record_values`).
- Add field: call `md_native_configure_field` (already creates the column).
- Delete field: drop the column / remove the key from `extras` and `present_fields` on that table.
- "Has values" checks: query the native table with `nativeValueSql`.
- `UPDATE md_record_values SET is_unique...`: delete (uniqueness is the index from Task E).
Done when: add + delete a field on a native Object works in `native-object-runtime-sql-smoke.mjs` (extend it).

## Task G - roll-ups, lookups, matching
Files: `relationship-engine/RollupAggregationManager.ts`, `LookupResolver.ts`, `RelationshipRegistry.ts`,
`RelationshipPathResolver.ts`, `object-engine/QueryBuilder.ts`, `object-engine/FilteredNumericAggregate.ts`,
`business-rule-engine/MatchingRuleEngine.ts`, `system-files/external-id-upsert.ts`,
`system-files/flow-record-query.ts`, `system-support/global-value-set-service.ts`,
`system-files/tenant-media-service.ts`, `system-support/metadata-loader-routes.ts`.
- Same patterns as C. Roll-up result write: `writeNativeValues` for the parent's roll-up field.
Done when: no file listed references `md_record_values`; CI scripts pass.

## Task H - drop the table (last, after all above merged)
- New boot DDL step (in `system-support/system-migrations.ts`, after `applyNativeObjectStorage`):
  if every non-deleted Object has a native table, `DROP TABLE IF EXISTS md_record_values CASCADE`
  and drop SQL functions that still reference it (list them with
  `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%md_record_values%'`; each must first be rewritten
  or deleted - list them in the PR).
- Remove `md_native_value_changed` trigger and `md_native_write_value` function.
- `apps/server/src/system-files/schema.sql`: remove `md_record_values` statements.
Done when: whole CI passes on a fresh database and `grep -rn md_record_values apps/server/src` shows only migration history.
