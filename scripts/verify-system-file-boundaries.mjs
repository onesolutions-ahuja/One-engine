import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('apps/server/src/system-files');
const files=fs.readdirSync(root,{withFileTypes:true});
const expected=['sql-persistence.ts','object-definition.ts','authentication.ts','rbac-engine.ts',
 'record-engine.ts','component-runtime.ts','page-runtime.ts','page-layout-version-runtime.ts','page-layout-device-inheritance.ts','flow-runtime.ts','app-runtime.ts',
 'tenant-provisioning.ts','schema.sql','session-metadata.ts','platform-tenant-service.ts',
 'system-definition-service.ts','custom-metadata-service.ts','object-manager-metadata.ts','object-manager-layout-controls.ts','object-manager-lookup-filters.ts',
 'flow-data-actions.ts','flow-decision-runtime.ts','flow-formula-runtime.ts','flow-record-query.ts',
 'flow-record-triggers.ts','flow-subflow-runtime.ts','flow-validation.ts','flow-capability-catalog.ts',
 'flow-debug-runtime.ts','flow-run-history.ts','flow-orchestration-runtime.ts',
 'flow-interview-persistence.ts','flow-wait-runtime.ts','flow-action-runtime.ts',
 'flow-subscription-runtime.ts','flow-scalar-runtime.ts','flow-error-runtime.ts',
 'flow-execution-context.ts','flow-assignment-runtime.ts','flow-execution-requests.ts','tenant-media-service.ts',
 'flow-screen-choice-runtime.ts','flow-screen-record-selection.ts','flow-http-mapping.ts','flow-integration-connection.ts',
 'auto-number-format.ts','platform-event-runtime.ts','record-file-service.ts','rich-text.ts',
 'record-query.ts','field-type-migration.ts','encrypted-field.ts','object-metadata-history.ts','object-schema-lifecycle.ts','field-definition-attributes.ts',
 'declarative-rules.ts','record-matching.ts','external-id-upsert.ts'];
const allowed=new Set(expected);
const nodeModules=new Set(['AssignmentNode.ts','DecisionNode.ts','WaitPauseNode.ts','LoopNode.ts','DataActionNodes.ts','NodeContext.ts','RecordNodeValidation.ts','GetRecordsNode.ts','CreateRecordsNode.ts','RecordMutationTargets.ts','RecordOverlapGuard.ts','RecordAvailabilityGuard.ts','AvailableSlotsNode.ts','DocumentFinancialGuard.ts','RecordPaymentGuard.ts','UpdateRecordsNode.ts','DeleteRecordsNode.ts','FilterCollectionNode.ts','SortCollectionNode.ts','TransformNode.ts','RollbackRecordsNode.ts','CustomErrorNode.ts','SubflowNode.ts','ScreenElementNode.ts','ActionNodeShared.ts','QuickActionNode.ts','PlatformEventPublishNode.ts','ActionEmailNode.ts','HttpCalloutNode.ts','CountCollectionNode.ts','ParseJsonNode.ts','BusinessContextNode.ts','ResumeEventNode.ts','ActionButtonNode.ts','CustomActionBridgeNode.ts']);
const nodesDir=path.join(root,'nodes');
const nodeEntries=fs.existsSync(nodesDir)?fs.readdirSync(nodesDir,{withFileTypes:true}):[];
const invalidNodeEntries=nodeEntries.filter(entry=>!entry.isFile()||!nodeModules.has(entry.name));
const forbidden=files.filter(f=>f.isDirectory()?f.name!=='nodes':!f.isFile()||!allowed.has(f.name));
if(forbidden.length||invalidNodeEntries.length){
 console.error('System runtime contains files outside the approved Core modules:',[...forbidden.map(f=>f.name),...invalidNodeEntries.map(f=>'nodes/'+f.name)]);
 process.exitCode=1;
}
const tests=fs.readdirSync('apps/server/test/system').filter(f=>f.endsWith('.test.ts'));
const consolidated=fs.existsSync('apps/server/test/system/backend.test.mjs');
if(tests.length<6&&!consolidated) {
 console.error('System regression tests missing from the dedicated test directory');
 process.exitCode=1;
}
const missing=expected.filter(name=>!fs.existsSync(path.join(root,name)));
if(missing.length){console.error('Mandatory core contract missing:',missing);process.exitCode=1;}
if(!process.exitCode)console.log('System file boundaries verified');

// Detect stale architectural references in current authoritative documentation.
for(const filename of ['docs/server-code-organisation.md','apps/server/src/system-files/README.md']) {
 if(!fs.existsSync(filename))continue;
 const document=fs.readFileSync(filename,'utf8');
 if(document.includes('src/system-files/entrypoint.ts')||document.includes('12 foundational engines')){
  console.error('Outdated Core architecture reference:',filename);process.exitCode=1;
 }
}
