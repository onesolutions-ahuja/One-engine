import { useState } from 'react';
import type { FlowDefinitionMetadata, FlowTestCaseMetadata } from '../../metadata/Definitions/metadata';

type FlowTestResult = { id: string; label: string; passed: boolean; actualStatus: string; details: string };

export default function FlowTestsPanel({ flow, isDirty, canRun, onChange, onRunTests, onNotify }: {
  flow: FlowDefinitionMetadata;
  isDirty: boolean;
  canRun: boolean;
  onChange: (flow: FlowDefinitionMetadata) => void;
  onRunTests: (flow: FlowDefinitionMetadata) => Promise<FlowTestResult[]>;
  onNotify: (message: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [input, setInput] = useState('{}');
  const [event, setEvent] = useState<'created' | 'updated' | 'deleted'>('created');
  const [record, setRecord] = useState('{"Id":"DEBUG-RECORD","Name":"Sample"}');
  const [prior, setPrior] = useState('{"Id":"DEBUG-RECORD","Name":"Previous"}');
  const [expectedStatus, setExpectedStatus] = useState<'completed' | 'waiting' | 'skipped'>('completed');
  const [expectedOutputs, setExpectedOutputs] = useState('{}');
  const [results, setResults] = useState<FlowTestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [page, setPage] = useState(1);
  const recordTriggered = flow.flowType === 'Record-Triggered Flow';
  const tests = flow.tests ?? [];
  const pages = Math.max(1, Math.ceil(tests.length / 50));
  const currentPage = Math.min(page, pages);
  const parseObject = (value: string, label: string): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Error(`${label} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  };
  const addTest = () => {
    if (!label.trim()) return onNotify('Enter a Flow Test name.');
    try {
      const test: FlowTestCaseMetadata = {
        id: crypto.randomUUID(), label: label.trim(),
        input: recordTriggered ? {} : parseObject(input, 'Input variables'),
        ...(recordTriggered ? {
          event, record: parseObject(record, 'Current record'),
          ...(event !== 'created' ? { prior: parseObject(prior, 'Prior record') } : {}),
          isClone: false
        } : {}),
        expectedStatus, expectedOutputs: parseObject(expectedOutputs, 'Expected outputs')
      };
      if (tests.length >= 100) throw Error('A Flow supports at most 100 saved tests.');
      onChange({ ...flow, tests: [...tests, test] });
      setLabel('');
      setResults([]);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Invalid Flow Test configuration');
    }
  };
  const runTests = async () => {
    setRunning(true);
    setResults([]);
    try {
      setResults(await onRunTests(flow));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Flow Tests could not run');
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="toolbox-group">
      <h3>Flow Tests</h3>
      <p className="settings-panel-copy">Save repeatable test fixtures with the Flow metadata. Run the most recently saved version in isolation: no records, communication or approvals are committed. Expected outputs are compared by resource name.</p>
      <label className="form-label">Test name
        <input className="form-control" aria-label="Flow Test name" maxLength={120}
          value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Example: eligible record follows Approved path" />
      </label>
      {recordTriggered ? <>
        <label className="form-label">Record event
          <select className="form-control" aria-label="Flow Test record event" value={event}
            onChange={(e) => setEvent(e.target.value as typeof event)}>
            <option value="created">Created</option><option value="updated">Updated</option><option value="deleted">Deleted</option>
          </select>
        </label>
        <label className="form-label">Current record JSON
          <textarea className="form-control" rows={4} aria-label="Flow Test current record" value={record}
            onChange={(e) => setRecord(e.target.value)} />
        </label>
        {event !== 'created' && <label className="form-label">Prior record JSON
          <textarea className="form-control" rows={4} aria-label="Flow Test prior record" value={prior}
            onChange={(e) => setPrior(e.target.value)} />
        </label>}
      </> : <label className="form-label">Input variables JSON
        <textarea className="form-control" rows={4} aria-label="Flow Test inputs" value={input}
          onChange={(e) => setInput(e.target.value)} />
      </label>}
      <label className="form-label">Expected result
        <select className="form-control" aria-label="Flow Test expected status" value={expectedStatus}
          onChange={(e) => setExpectedStatus(e.target.value as typeof expectedStatus)}>
          <option value="completed">Completed</option><option value="waiting">Waiting / paused</option>
          {recordTriggered && <option value="skipped">Skipped by entry criteria</option>}
        </select>
      </label>
      <label className="form-label">Expected output variables JSON
        <textarea className="form-control" rows={3} aria-label="Flow Test expected outputs" value={expectedOutputs}
          onChange={(e) => setExpectedOutputs(e.target.value)} placeholder={'{"ApprovalStatus":"Approved"}'} />
      </label>
      <button type="button" className="btn" onClick={addTest} disabled={!label.trim()}>Add Test</button>
      <button type="button" className="btn btn-brand" onClick={() => void runTests()}
        disabled={!tests.length || isDirty || !canRun || running}
        title={isDirty ? 'Save the Flow before running tests.' : undefined}>
        {running ? 'Running Tests…' : `Run All ${tests.length} Tests`}
      </button>
      {isDirty && tests.length > 0 && <p className="settings-panel-copy">Save the Flow to run these test cases.</p>}
      {results.length > 0 && <div role="status" className="flow-validation">
        <strong>{results.filter((item) => item.passed).length} / {results.length} tests passed</strong>
        {results.map((item) => <p key={item.id}>
          <strong>{item.passed ? 'PASS' : 'FAIL'} · {item.label}</strong>
          <span> · {item.actualStatus} · {item.details}</span>
        </p>)}
      </div>}
      <h4>Saved test cases ({tests.length})</h4>
      {tests.slice((currentPage - 1) * 50, currentPage * 50).map((test) => <div className="flow-resource-card" key={test.id}>
        <strong>{test.label}</strong>
        <small>Expected: {test.expectedStatus} · {test.event ?? 'Manual inputs'} · {Object.keys(test.expectedOutputs ?? {}).length} output checks</small>
        <button type="button" className="text-action" onClick={() => {
          onChange({ ...flow, tests: tests.filter((item) => item.id !== test.id) });
          setResults([]);
        }}>Delete Test</button>
      </div>)}
      {tests.length > 50 && <div className="flow-config-row">
        <button className="btn" disabled={currentPage <= 1} onClick={() => setPage(1)}>First</button>
        <button className="btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>{currentPage} / {pages}</span>
        <button className="btn" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button>
        <button className="btn" disabled={currentPage >= pages} onClick={() => setPage(pages)}>Last</button>
      </div>}
    </div>
  );
}
