import { resolveConfig } from './config.ts';
import { argumentSimilarity, canonicalArgs } from './normalize.ts';
import { eventSize, ratio, sumSizes, usageSize } from './tokens.ts';
import type { Config, Event, Evidence, FailureFinding, Finding, OutputEntry, Report, SessionInput, ToolCall, ToolResult } from './types.ts';

interface Attempt {
  call: ToolCall;
  result: ToolResult | undefined;
  epoch: number;
  exact: string;
  normalized: string;
}

function evidence(event: ToolCall | ToolResult): Evidence {
  return { kind: event.kind, seq: event.seq, turn: event.turn, ...(event.step !== undefined ? { step: event.step } : {}),
    callId: event.kind === 'tool_call' ? event.id : event.callId };
}

function validatePosition(event: Event, lastSeq: number): void {
  if (!Number.isSafeInteger(event.seq) || event.seq <= lastSeq || event.seq < 0) throw new RangeError('Event seq must be unique and strictly increasing');
  if (event.turn !== null && (!Number.isSafeInteger(event.turn) || event.turn < 0)) throw new RangeError('Invalid event turn');
  if (event.step !== undefined && (!Number.isSafeInteger(event.step) || event.step < 0)) throw new RangeError('Invalid event step');
}

function failureIdentity(result: ToolResult): string | undefined {
  const identity = result.failureKey ?? result.text;
  return identity?.trim() || undefined;
}

function detectFailures(attempts: readonly Attempt[], config: Config): FailureFinding[] {
  const findings: FailureFinding[] = [];
  let run: Attempt[] = [];
  let match: FailureFinding['match'] = 'exact';
  function flush() {
    if (run.length >= config.failLoopMin) {
      const first = run[0]!;
      const repeated = run.slice(1);
      const weakEvidence = run.some(attempt => attempt.result?.outcomeSource !== 'structured');
      findings.push({
        id: `R1:${first.call.seq}`, rule: 'R1', tool: first.call.tool, attempts: run.length, match,
        confidence: match === 'exact' && !weakEvidence ? 'high' : 'medium',
        evidence: run.flatMap(attempt => [evidence(attempt.call), evidence(attempt.result!)]),
        repeatedCallIds: repeated.map(attempt => attempt.call.id),
        repeatedContent: sumSizes(repeated.flatMap(attempt => [eventSize(attempt.call), eventSize(attempt.result!)])),
        limitations: ['仅识别已记录的连续尝试；无法排除外部状态变化，也不能证明每次重试均可省略。',
          ...(match === 'similar' ? ['参数相似为字符启发式，不能证明两个操作语义相同。'] : []),
          ...(weakEvidence ? ['部分失败依据来自文本或未声明来源，需人工复核。'] : [])],
        suggestion: '同一操作在未观察到新诊断或相关修改时，两次返回相同错误后，先定位错误并选择新的诊断步骤；已确认的瞬时故障可有限退避重试。',
      });
    }
    run = []; match = 'exact';
  }
  for (const attempt of attempts) {
    const result = attempt.result;
    if (!result || result.outcome !== 'failure' || !failureIdentity(result)) { flush(); continue; }
    const anchor = run[0], previous = run[run.length - 1];
    if (anchor && previous) {
      const compatible = attempt.epoch === anchor.epoch && attempt.call.tool === anchor.call.tool
        && previous.result!.seq < attempt.call.seq
        && failureIdentity(result) === failureIdentity(anchor.result!)
        && argumentSimilarity(attempt.normalized, anchor.normalized) >= config.similarityThreshold;
      if (!compatible) flush();
      else if (attempt.normalized !== anchor.normalized) match = 'similar';
      else if (attempt.exact !== anchor.exact && match !== 'similar') match = 'normalized';
    }
    run.push(attempt);
  }
  flush();
  return findings;
}

export function analyzeSession(input: SessionInput, overrides: Partial<Config> = {}): Report {
  const config = resolveConfig(overrides);
  if (input.scope !== 'full-log' && input.scope !== 'current-surface') throw new TypeError('Invalid analysis scope');
  const calls = new Map<string, ToolCall>(), results = new Map<string, ToolResult>();
  const attempts: Attempt[] = [], issues: string[] = [];
  let epoch = 0, lastSeq = -1;
  const turns = new Set<number>();
  for (const event of input.events) {
    validatePosition(event, lastSeq); lastSeq = event.seq;
    if (event.turn !== null) turns.add(event.turn);
    if (event.barrier || event.kind === 'boundary' || (event.kind === 'user' && event.source !== 'injected')) epoch++;
    if (event.kind === 'tool_call') {
      if (!event.id || !event.tool || calls.has(event.id)) throw new TypeError('Tool call ids must be nonempty and unique');
      calls.set(event.id, event);
      attempts.push({ call: event, result: undefined, epoch, exact: canonicalArgs(event.args), normalized: canonicalArgs(event.args, config) });
    } else if (event.kind === 'tool_result') {
      if (!event.callId || results.has(event.callId)) throw new TypeError('Tool result ids must be nonempty and unique');
      if (calls.has(event.callId) && calls.get(event.callId)!.seq >= event.seq) throw new TypeError('Tool result must follow its call');
      results.set(event.callId, event);
    }
  }
  for (const attempt of attempts) {
    attempt.result = results.get(attempt.call.id);
    if (attempt.result && attempt.result.seq <= attempt.call.seq) throw new TypeError('Tool result must follow its call');
  }
  if (attempts.some(attempt => !attempt.result)) issues.push('存在没有结果的调用，按未解决处理，不据此推断失败。');
  if ([...results.values()].some(result => result.outcome === 'failure' && !failureIdentity(result))) {
    issues.push('部分失败缺少错误标识或文本，未将其合并为相同错误循环。');
  }
  if ([...results.keys()].some(id => !calls.has(id))) issues.push('存在未配对结果；保留其输出体积，但不推断所属工具或失败循环。');
  const contentSize = sumSizes(input.events.map(eventSize));
  if (contentSize.value === null) issues.push('部分事件缺少文本和内容 token 数，会话总体体积与比例不可用。');
  const findings: Finding[] = detectFailures(attempts, config);
  const outputEntries: OutputEntry[] = [...results.values()].map(result => {
    const size = eventSize(result);
    return { callId: result.callId, tool: calls.get(result.callId)?.tool ?? null,
      position: { seq: result.seq, turn: result.turn, ...(result.step !== undefined ? { step: result.step } : {}) },
      size, sessionContentRatio: ratio(size, contentSize) };
  });
  for (const output of outputEntries) {
    if (output.size.value !== null && output.size.value > config.bigOutputTokens) {
      findings.push({ id: `R3:${output.position.seq}`, rule: 'R3', confidence: output.size.method === 'reported' ? 'high' : 'medium', output,
        evidence: [{ ...output.position, kind: 'tool_result', callId: output.callId }],
        limitations: ['大输出只说明内容体积，不证明无用或可全部省略；字符估算不是模型分词。'],
        suggestion: '按任务需要先搜索或限制输出范围，只保留相关片段；确需完整输出时保留。' });
    }
  }
  const repeatedIds = new Set(findings.flatMap(finding => finding.rule === 'R1' ? finding.repeatedCallIds : []));
  const repeatedEvents = attempts.filter(attempt => repeatedIds.has(attempt.call.id))
    .flatMap(attempt => [attempt.call, attempt.result!]);
  const suspectedAvoidableContent = sumSizes(repeatedEvents.map(eventSize));
  const assistants = input.events.filter(event => event.kind === 'assistant');
  const usages = assistants.flatMap(event => event.requestUsage ? [usageSize(event.requestUsage)] : []);
  const requestUsage = usages.length === assistants.length && assistants.length > 0
    ? sumSizes(usages) : { value: null, method: 'unavailable' as const };
  return {
    schemaVersion: '0.1', sessionId: input.id, scope: input.scope, turns: turns.size,
    findings: findings.sort((a, b) => a.evidence[0]!.seq - b.evidence[0]!.seq || a.rule.localeCompare(b.rule)),
    topOutputs: outputEntries.filter(output => output.size.value !== null)
      .sort((a, b) => b.size.value! - a.size.value! || a.position.seq - b.position.seq).slice(0, config.topN),
    contentSize, suspectedAvoidableContent, suspectedAvoidableRatio: ratio(suspectedAvoidableContent, contentSize),
    requestUsage, requestUsageCoverage: { reported: usages.length, assistantMessages: assistants.length }, issues,
  };
}
