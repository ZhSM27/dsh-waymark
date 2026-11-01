import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSession, DEFAULT_CONFIG, renderReport } from '../src/core/index.ts';
import { estimateText } from '../src/core/tokens.ts';
import { canonicalArgs, argumentSimilarity } from '../src/core/normalize.ts';
import { builder, failureLoop, productiveIteration, session } from './fixtures/sessions.mjs';

const r1 = report => report.findings.filter(f => f.rule === 'R1');
const r3 = report => report.findings.filter(f => f.rule === 'R3');

test('empty and ordinary successful sessions have no findings', () => {
  assert.deepEqual(analyzeSession(session()).findings, []);
  const b = builder();
  b.add({ kind: 'user', source: 'human', text: 'Check the synthetic example' });
  b.attempt(undefined, undefined, { outcome: 'success', text: 'Example passed' });
  const report = analyzeSession(b.session());
  assert.deepEqual(report.findings, []);
  assert.equal(report.turns, 1);
  assert.equal(report.suspectedAvoidableContent.value, 0);
});

test('R1 detects all attempts, retains exact evidence and excludes the first attempt from waste', () => {
  const b = builder();
  for (let i = 0; i < 4; i++) b.attempt(undefined, { tokens: 10, turn: i + 1 }, { tokens: 20, turn: i + 1 });
  const report = analyzeSession(b.session());
  const [finding] = r1(report);
  assert.equal(r1(report).length, 1);
  assert.equal(finding.attempts, 4);
  assert.equal(finding.confidence, 'high');
  assert.deepEqual(finding.evidence.map(e => e.seq), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(finding.repeatedCallIds.length, 3);
  assert.deepEqual(finding.repeatedContent, { value: 90, method: 'reported' });
  assert.equal(report.suspectedAvoidableRatio, 0.75);
});

test('failure loop threshold is inclusive and configurable', () => {
  assert.equal(r1(analyzeSession(failureLoop(2))).length, 0);
  assert.equal(r1(analyzeSession(failureLoop(3))).length, 1);
  assert.equal(r1(analyzeSession(failureLoop(3), { failLoopMin: 4 })).length, 0);
});

test('successful edits and new diagnostic tool calls split a retry run', () => {
  assert.deepEqual(analyzeSession(productiveIteration()).findings, []);
  const b = builder();
  for (let i = 0; i < 3; i++) {
    b.attempt();
    b.attempt({ query: 'synthetic error' }, { tool: 'search' }, { outcome: 'success', text: 'New diagnostic evidence' });
  }
  assert.equal(r1(analyzeSession(b.session())).length, 0);
});

test('a human message, unknown user source or explicit boundary splits a loop', () => {
  for (const separator of [
    { kind: 'user', source: 'human', text: 'Try another approach' },
    { kind: 'user', source: 'unknown', text: 'Unknown context' },
    { kind: 'boundary', reason: 'state-change' },
  ]) {
    const b = builder();
    b.attempt(); b.attempt(); b.add(separator); b.attempt();
    assert.equal(r1(analyzeSession(b.session())).length, 0);
  }
});

test('assistant narration and injected user-role text are not counted as extra attempts', () => {
  const b = builder();
  for (let i = 0; i < 3; i++) {
    b.attempt();
    b.add({ kind: 'assistant', text: 'Synthetic narration' });
    b.add({ kind: 'user', source: 'injected', text: 'Synthetic catalog' });
  }
  assert.equal(r1(analyzeSession(b.session()))[0].attempts, 3);
});

test('unknown, interrupted, unresolved or successful results are not failures', () => {
  for (const outcome of ['unknown', 'interrupted', 'unresolved', 'success']) {
    const b = builder();
    b.attempt(); b.attempt(undefined, undefined, { outcome }); b.attempt();
    assert.equal(r1(analyzeSession(b.session())).length, 0);
  }
});

test('missing results and missing error identity never fabricate a failure loop', () => {
  const b = builder();
  for (let i = 0; i < 3; i++) b.call();
  const missing = analyzeSession(b.session());
  assert.equal(r1(missing).length, 0);
  assert.equal(missing.issues.length, 1);
  const empty = builder();
  for (let i = 0; i < 3; i++) empty.attempt(undefined, undefined, { text: '' });
  const report = analyzeSession(empty.session());
  assert.equal(r1(report).length, 0);
  assert.match(report.issues.join(), /错误标识/);
});

test('parallel failures are not interpreted as serial retries', () => {
  const b = builder();
  const calls = [b.call(), b.call(), b.call()];
  for (const call of calls) b.result(call);
  assert.equal(r1(analyzeSession(b.session())).length, 0);
});

test('different errors split runs; explicit stable failure keys support varying output', () => {
  const b = builder();
  for (let i = 0; i < 3; i++) b.attempt(undefined, undefined, { text: `Synthetic error ${i}` });
  assert.equal(r1(analyzeSession(b.session())).length, 0);
  const keyed = builder();
  for (let i = 0; i < 3; i++) keyed.attempt(undefined, undefined, { text: `Context ${i}`, failureKey: 'synthetic-check-error' });
  assert.equal(r1(analyzeSession(keyed.session())).length, 1);
});

test('JSON key ordering is stable and volatile fields require explicit opt-in', () => {
  const b = builder();
  b.attempt({ command: 'example-check', timestamp: 1 });
  b.attempt({ timestamp: 2, command: 'example-check' });
  b.attempt({ command: 'example-check', timestamp: 3 });
  assert.equal(r1(analyzeSession(b.session())).length, 0);
  const report = analyzeSession(b.session(), { volatileArgumentKeys: ['timestamp'] });
  assert.equal(r1(report)[0].match, 'normalized');
  assert.equal(r1(report)[0].confidence, 'medium');
  assert.equal(canonicalArgs({ b: 1, a: 2 }), canonicalArgs({ a: 2, b: 1 }));
});

test('argument similarity is configurable, numeric targets remain distinct', () => {
  const b = builder();
  for (const command of ['example-check --verbose', 'example-check --verbose ', 'example-check --verbose  ']) b.attempt({ command });
  assert.equal(r1(analyzeSession(b.session()))[0].match, 'similar');
  assert.equal(r1(analyzeSession(b.session(), { similarityThreshold: 1 })).length, 0);
  const numeric = builder();
  for (const command of ['example-check task1', 'example-check task2', 'example-check task3']) numeric.attempt({ command });
  assert.equal(r1(analyzeSession(numeric.session())).length, 0);
});

test('similarity is measured against the anchor, avoiding gradual drift', () => {
  const values = ['abcdef', 'abcdeg', 'abcdfg'].map(command => canonicalArgs({ command }));
  const ab = argumentSimilarity(values[0], values[1]);
  const bc = argumentSimilarity(values[1], values[2]);
  const ac = argumentSimilarity(values[0], values[2]);
  assert.ok(Math.min(ab, bc) > ac);
  const b = builder();
  for (const command of ['abcdef', 'abcdeg', 'abcdfg']) b.attempt({ command });
  assert.equal(r1(analyzeSession(b.session(), { similarityThreshold: (ac + Math.min(ab, bc)) / 2 })).length, 0);
});

test('R3 uses a strict threshold and ranks top N regardless of findings', () => {
  const b = builder();
  for (const tokens of [4000, 4001, 20, 5000, 30, 40]) b.attempt(undefined, undefined, { outcome: 'success', text: '', tokens });
  const report = analyzeSession(b.session(), { topN: 2 });
  assert.deepEqual(r3(report).map(f => f.output.size.value), [4001, 5000]);
  assert.deepEqual(report.topOutputs.map(f => f.size.value), [5000, 4001]);
  assert.equal(report.suspectedAvoidableContent.value, 0);
  assert.ok(r3(report).every(f => f.evidence.length === 1));
});

test('R3 estimates Unicode code points and marks heuristic findings', () => {
  assert.equal(estimateText('😀汉ab').value, 1);
  const b = builder();
  b.attempt(undefined, undefined, { outcome: 'success', text: '汉'.repeat(16004) });
  const finding = r3(analyzeSession(b.session()))[0];
  assert.equal(finding.output.size.value, 4001);
  assert.equal(finding.output.size.method, 'estimated');
  assert.equal(finding.confidence, 'medium');
});

test('R3 and R1 share evidence without double counting repeated output', () => {
  const b = builder();
  for (let i = 0; i < 3; i++) b.attempt(undefined, { tokens: 10 }, { tokens: 5000 });
  const report = analyzeSession(b.session());
  assert.equal(report.findings.length, 4);
  assert.equal(report.suspectedAvoidableContent.value, 10020);
  assert.equal(report.suspectedAvoidableRatio, 2 / 3);
});

test('missing output content is unavailable, not zero; orphan outputs remain visible', () => {
  const b = builder();
  const call = b.call();
  b.add({ kind: 'tool_result', callId: call.id, outcome: 'unknown' });
  b.add({ kind: 'tool_result', callId: 'synthetic-orphan', outcome: 'success', tokens: 5000 });
  const report = analyzeSession(b.session());
  assert.equal(report.contentSize.value, null);
  assert.equal(report.topOutputs[0].tool, null);
  assert.equal(report.topOutputs[0].sessionContentRatio, null);
  assert.match(report.issues.join(), /未配对/);
});

test('reported zero content counts are retained', () => {
  const b = builder();
  b.attempt(undefined, { tokens: 0 }, { outcome: 'success', tokens: 0 });
  const report = analyzeSession(b.session());
  assert.equal(report.contentSize.value, 0);
  assert.equal(report.topOutputs[0].size.value, 0);
  assert.equal(report.topOutputs[0].sessionContentRatio, null);
});

test('request usage is separate; caches included once and reasoning never double counted', () => {
  const b = builder();
  b.add({ kind: 'assistant', text: 'abcd', requestUsage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 5, reasoningTokens: 10 } });
  const report = analyzeSession(b.session());
  assert.equal(report.contentSize.value, 1);
  assert.equal(report.requestUsage.value, 155);
  b.add({ kind: 'assistant', text: '' });
  const partial = analyzeSession(b.session());
  assert.equal(partial.requestUsage.value, null);
  assert.deepEqual(partial.requestUsageCoverage, { reported: 1, assistantMessages: 2 });
});

test('reported request totals are not added twice and inconsistent counters are rejected', () => {
  const b = builder();
  b.add({ kind: 'assistant', text: '', requestUsage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, totalTokens: 150 } });
  assert.equal(analyzeSession(b.session()).requestUsage.value, 150);
  b.events[0].requestUsage.totalTokens = 180;
  assert.throws(() => analyzeSession(b.session()), /disagrees/);
  b.events[0].requestUsage = { inputTokens: 0, outputTokens: 5, reasoningTokens: 10 };
  assert.throws(() => analyzeSession(b.session()), /Reasoning/);
});

test('explicit temporary-root normalization retains distinct relative targets', () => {
  const config = { ...DEFAULT_CONFIG, temporaryPathPrefixes: ['synthetic-temp-a/', 'synthetic-temp-b/'] };
  assert.equal(canonicalArgs({ target: 'synthetic-temp-a/sample.txt' }, config), canonicalArgs({ target: 'synthetic-temp-b/sample.txt' }, config));
  assert.notEqual(canonicalArgs({ target: 'synthetic-temp-a/other.txt' }, config), canonicalArgs({ target: 'synthetic-temp-b/sample.txt' }, config));
});

test('changing tools and successful results both end failure episodes', () => {
  const b = builder();
  b.attempt(); b.attempt();
  b.attempt(undefined, { tool: 'other-shell' });
  b.attempt(undefined, undefined, { outcome: 'success', text: '' });
  b.attempt(); b.attempt();
  assert.equal(r1(analyzeSession(b.session())).length, 0);
});

test('mixed known and estimated sizes retain the estimation label', () => {
  const b = builder();
  for (let i = 0; i < 3; i++) b.attempt(undefined, { tokens: 10 }, { text: 'xxxx' });
  const report = analyzeSession(b.session());
  assert.deepEqual(report.suspectedAvoidableContent, { value: 22, method: 'mixed' });
  assert.match(renderReport(report), /22 token（估算）/);
});

test('orphan-only outputs can produce R3 without inventing a tool or turn', () => {
  const report = analyzeSession(session([{ kind: 'tool_result', seq: 2, turn: null, callId: 'synthetic-orphan', outcome: 'unknown', tokens: 5000 }]));
  assert.equal(report.turns, 0);
  assert.equal(r1(report).length, 0);
  assert.match(renderReport(report), /轮次未知/);
  assert.match(renderReport(report), /未配对工具/);
});

test('duplicate results and a result preceding its call are refused', () => {
  const b = builder();
  const call = b.call(); b.result(call); b.result(call);
  assert.throws(() => analyzeSession(b.session()), /unique/);
  assert.throws(() => analyzeSession(session([
    { kind: 'tool_result', seq: 0, turn: 1, callId: 'synthetic-a', outcome: 'failure', text: 'Example' },
    { kind: 'tool_call', seq: 1, turn: 1, id: 'synthetic-a', tool: 'example', args: {} },
  ])), /follow/);
});

test('renderer shows range, estimates, scope, limits and bounded finding count', () => {
  const b = builder();
  for (let i = 0; i < 3; i++) b.attempt(undefined, undefined, { text: 'x'.repeat(16004) });
  const text = renderReport(analyzeSession(b.session()));
  assert.match(text, /发现 4 项/);
  assert.match(text, /seq 0–5/);
  assert.match(text, /估算/);
  assert.match(text, /非当前上下文快照/);
  assert.match(text, /其余 1 项未展开/);
  assert.match(text, /建议规则/);
  assert.doesNotMatch(text, /x{10}/);
});

test('untrusted labels cannot inject lines, ANSI escape sequences or bidi controls', () => {
  const input = failureLoop();
  input.id = 'synthetic\n\u001b[31m\u202e';
  const header = renderReport(analyzeSession(input)).split('\n')[0];
  assert.doesNotMatch(header, /[\u001b\u202e]/);
  assert.match(header, /共 1 轮/);
});

test('inputs are not mutated', () => {
  const input = productiveIteration();
  const before = structuredClone(input);
  analyzeSession(input);
  assert.deepEqual(input, before);
});

test('invalid configs, event identities, counts and JSON fail clearly', () => {
  for (const config of [{ failLoopMin: 1 }, { topN: 0 }, { bigOutputTokens: -1 }, { similarityThreshold: NaN }, { similarityThreshold: 0 }, { volatileArgumentKeys: [''] }]) {
    assert.throws(() => analyzeSession(session(), config));
  }
  const duplicate = failureLoop(); duplicate.events[1].seq = 0;
  assert.throws(() => analyzeSession(duplicate), /seq/);
  const duplicateId = failureLoop(); duplicateId.events[2].id = duplicateId.events[0].id;
  assert.throws(() => analyzeSession(duplicateId), /unique/);
  const negative = failureLoop(); negative.events[0].tokens = -1;
  assert.throws(() => analyzeSession(negative), /Token/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalArgs(cyclic), /acyclic/);
  assert.throws(() => canonicalArgs({ missing: undefined }), /JSON/);
  assert.throws(() => renderReport(analyzeSession(session()), { maxFindings: 0 }));
  assert.equal(DEFAULT_CONFIG.failLoopMin, 3);
});
