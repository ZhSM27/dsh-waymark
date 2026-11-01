import type { Event, RequestUsage, SessionInput, ToolResult } from '../core/types.ts';
import { usageSize } from '../core/tokens.ts';

/** Structural public DTOs verified against dsh 0.2.1-rc.5. Runtime input is validated. */
export interface DshSnapshot {
  readonly session: { readonly id: string; readonly cwd?: string; readonly version: number };
  readonly inheritedEventCount: number;
  readonly events: readonly unknown[];
}

type RecordValue = Record<string, unknown>;
export const record = (value: unknown): RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : {};
const text = (content: unknown): string => Array.isArray(content) ? content.flatMap(block => {
  const item = record(block);
  return (item.type === 'text' || item.type === 'reasoning') && typeof item.text === 'string' ? [item.text] : [];
}).join('\n') : '';
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function outcome(tool: string | undefined, data: RecordValue, body: string, args: RecordValue): Pick<ToolResult, 'outcome' | 'outcomeSource'> {
  const message = record(data.message), error = record(data.error);
  if (error.name === 'AbortError' || /ABORT|CANCEL|TIMEOUT/i.test(String(error.code ?? ''))) return { outcome: 'interrupted', outcomeSource: 'structured' };
  if (message.isError === true) return { outcome: 'failure', outcomeSource: 'structured' };
  if (tool === 'bash' || tool === 'pwsh') {
    if (args.run_in_background === true || /\[(?:still running|timed out|stopped:|killed by signal:)|^started background job|\[sandbox:/m.test(body)) {
      return { outcome: 'unknown', outcomeSource: 'text-marker' };
    }
    const exit = /(?:^|\n)\[exit code: (-?\d+)\]\s*$/.exec(body);
    // Windows pwsh exit 1 can also be an externally killed process: never infer a loop from it.
    if (tool === 'pwsh' && exit?.[1] === '1') return { outcome: 'unknown', outcomeSource: 'text-marker' };
    return { outcome: exit && Number(exit[1]) !== 0 ? 'failure' : 'success', outcomeSource: 'text-marker' };
  }
  return { outcome: tool ? 'success' : 'unknown', outcomeSource: tool ? 'structured' : 'unknown' };
}

export function adaptDshSession(snapshot: DshSnapshot): { input: SessionInput; issues: string[] } {
  if (snapshot.session.version !== 4) throw new TypeError('Unsupported logical dsh session format');
  const events: Event[] = [], issues: string[] = [];
  const calls = new Map<string, { tool: string; args: RecordValue; valid: boolean }>();
  let turn: number | null = null, lastSeq = -1;
  for (const raw of snapshot.events) {
    const event = record(raw), data = record(event.data);
    if (!integer(event.seq) || event.seq <= lastSeq) throw new TypeError('Invalid dsh event sequence');
    lastSeq = event.seq;
    if (event.type === 'turn/start' && integer(data.turn)) turn = data.turn;
    const position = { seq: event.seq, turn: integer(data.turn) ? data.turn : turn,
      ...(integer(data.step) ? { step: data.step } : {}),
      ...(typeof event.surfaceOp === 'object' && record(event.surfaceOp).op === 'replace' ? { barrier: true } : {}) };
    const boundary = (reason: Extract<Event, { kind: 'boundary' }>['reason']) => events.push({ ...position, kind: 'boundary', reason });
    switch (event.type) {
      case 'user/message': {
        const source = record(data.source).kind;
        events.push({ ...position, kind: 'user', text: text(data.content), source: source === 'user' ? 'human' : typeof source === 'string' ? 'injected' : 'unknown' });
        break;
      }
      case 'system/message': case 'developer/message':
        events.push({ ...position, kind: 'user', source: 'injected', text: text(record(data.message).content) }); break;
      case 'assistant/message': {
        let requestUsage: RequestUsage | undefined;
        if (data.usage !== undefined) {
          try {
            const usage = record(data.usage);
            if (!integer(usage.inputTokens) || !integer(usage.outputTokens)) throw new TypeError('Invalid usage');
            requestUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
              ...Object.fromEntries(['totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
                .filter(key => usage[key] !== undefined).map(key => [key, usage[key]])) } as RequestUsage;
            usageSize(requestUsage);
          } catch { requestUsage = undefined; issues.push(`seq ${event.seq}: invalid request usage omitted`); }
        }
        events.push({ ...position, kind: 'assistant', text: text(record(data.message).content),
          ...(requestUsage ? { requestUsage } : {}), ...(data.interrupted ? { barrier: true } : {}) });
        break;
      }
      case 'tool/call': {
        if (typeof data.callId !== 'string' || typeof data.name !== 'string' || typeof data.arguments !== 'string') throw new TypeError('Malformed dsh tool call');
        let args: unknown = data.arguments, valid = false;
        try { args = JSON.parse(data.arguments); valid = true; } catch { issues.push(`seq ${event.seq}: malformed tool arguments`); }
        calls.set(data.callId, { tool: data.name, args: record(args), valid });
        events.push({ ...position, kind: 'tool_call', id: data.callId, tool: data.name, args, argsText: data.arguments, ...(!valid ? { barrier: true } : {}) });
        break;
      }
      case 'tool/result': {
        const message = record(data.message);
        if (typeof message.toolCallId !== 'string') throw new TypeError('Malformed dsh tool result');
        const call = calls.get(message.toolCallId), body = text(message.content);
        events.push({ ...position, kind: 'tool_result', callId: message.toolCallId, text: body,
          ...(call?.valid === false ? { outcome: 'unknown', outcomeSource: 'unknown' } as const : outcome(call?.tool, data, body, call?.args ?? {})) });
        break;
      }
      case 'assistant/attempt': boundary('interruption'); issues.push('Uncommitted model attempts are not included in request-usage totals'); break;
      case 'session/end-seed': boundary('history-cut'); break;
      case 'turn/end':
        if (data.reason !== 'completed') boundary('interruption');
        turn = null; break;
      case 'turn/start': case 'step/start': case 'step/end': case 'request/header': case 'request/context':
      case 'command/run': case 'command/done': break;
      default:
        // Unknown required records can alter interpretation: stop retry grouping conservatively.
        if (event.ignorable !== true) { boundary('unknown'); issues.push(`Unmapped event type: ${String(event.type).slice(0, 80)}`); }
    }
  }
  if (snapshot.inheritedEventCount > 0) issues.push('Includes fork-inherited history; do not sum costs across related sessions');
  issues.push('Content volume covers extracted text, reasoning and call arguments; excludes media and tool-schema tokenization');
  return { input: { id: snapshot.session.id, scope: 'full-log', events }, issues: [...new Set(issues)] };
}
