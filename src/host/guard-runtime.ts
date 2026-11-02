import { randomUUID, createHash } from 'node:crypto';
import { GuardState, guardOptions, type GuardOptions } from '../core/guard.ts';
import { canonicalArgs } from '../core/normalize.ts';
import { adaptDshSession, record } from '../adapters/dsh.ts';
import { admitted, type WorkspaceRegistry } from './session-policy.ts';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
type Agent = { session: { id: string; header: { origin?: string; cwd?: string; isSeeded?: boolean } } };
export interface LiveContext {
  readonly workspaceRegistry?: WorkspaceRegistry;
  on?(name: string, listener: (...args: any[]) => any): unknown;
}
/** No history reads, network, tool mutation, automatic execution or persistent plugin state. */
export function installGuard(ctx: LiveContext, overrides: Partial<GuardOptions> = {}) {
  const options = guardOptions(overrides);
  const states = new Map<Agent, GuardState>();
  const dispatched = new WeakSet<object>();
  const get = (agent: Agent): GuardState | undefined => {
    if (!admitted(ctx.workspaceRegistry, agent.session.id) || agent.session.header.origin || agent.session.header.isSeeded) { states.delete(agent); return undefined; }
    return states.get(agent);
  };
  ctx.on?.('tools/pre-execute', async (exec, next) => {
    const state = exec.agent && get(exec.agent);
    if (state && !exec.signal.aborted && !exec.parent) {
      try { const args = canonicalArgs(exec.arguments); if (args.length > 16000) state.reset(); else state.begin(exec.callId, digest(`${exec.name}:${args}`)); }
      catch { state.reset(); }
    } else if (state) state.reset();
    return next();
  });
  ctx.on?.('tools/result', (exec, result) => {
    const state = exec.agent && get(exec.agent);
    if (!state || exec.parent || exec.signal.aborted) { state?.reset(); return; }
    // Live results use error.info; durable records use data.error. Adapt explicitly.
    const data = { message: { toolCallId: exec.callId, content: result.content, isError: result.isError }, error: result.error?.info };
    const adapted = adaptDshSession({ session: { id: 'live', version: 4 }, inheritedEventCount: 0, events: [
      { seq: 0, type: 'tool/call', data: { callId: exec.callId, name: exec.name, arguments: JSON.stringify(exec.arguments) } },
      { seq: 1, type: 'tool/result', data },
    ] }).input.events.at(-1);
    if (adapted?.kind !== 'tool_result') return;
    const body = adapted.text ?? '';
    // Large or unstructured diagnostics cannot establish a reliable identical failure reason.
    const failure = adapted.outcome === 'failure' && body.length <= 4000 ? digest(`${JSON.stringify(result.error?.info ?? null)}:${body}`) : undefined;
    let chars = 0; for (const _char of body) chars++;
    state.settle(exec.callId, dispatched.has(exec) ? adapted.outcome : 'unknown', failure, chars / 4);
  });
  ctx.on?.('tools/execute', (exec, next) => { dispatched.add(exec); return next(); });
  ctx.on?.('agent/pre-step', async (payload, next) => {
    const state = get(payload.agent);
    if (payload.messages.some((message: any) => message.source?.kind === 'user')) state?.reset();
    const downstream = await next();
    if (!state || get(payload.agent) !== state || state.delivery !== 'model' || payload.signal.aborted || downstream.kind !== 'enter') return downstream;
    const notice = state.peek(payload.turn);
    if (!notice) return downstream;
    const message = Object.freeze({ id: randomUUID(), role: 'user', content: Object.freeze([Object.freeze({ type: 'text', text: state.render(notice) })]),
      source: Object.freeze({ kind: 'waymark', form: 'notice', summary: `Waymark ${notice.rule}` }) });
    state.delivered(payload.turn);
    return { ...downstream, messages: [...downstream.messages, message] };
  });
  ctx.on?.('session/event', (session, event) => {
    // Evaluate admission before touching event content. Archived cached state is removed.
    for (const [agent, state] of states) if (agent.session.id === session.id && get(agent)) {
      if (event.type === 'tool/result' && typeof event.data?.message?.toolCallId === 'string') state.reference(event.data.message.toolCallId,event.seq);
      if (event.type === 'user/message' && record(event.data?.source).kind === 'user'
        || ['assistant/attempt', 'session/end-seed'].includes(event.type)
        || event.type === 'turn/end' && event.data?.reason !== 'completed'
        || event.surfaceOp?.op === 'replace') state.reset();
      else if (!['user/message','system/message','developer/message','assistant/message','tool/call','tool/result','turn/start','turn/end','step/start','step/end','request/header','request/context','command/run','command/done'].includes(event.type) && event.ignorable !== true) state.reset();
    }
  });
  ctx.on?.('session/disposed', session => { for (const agent of states.keys()) if (agent.session.id === session.id) states.delete(agent); });
  ctx.on?.('workspace/session-stop', ({ sessionId }) => { for (const agent of states.keys()) if (agent.session.id === sessionId) states.delete(agent); });
  ctx.on?.('agent/disposed', ({ agent }) => states.delete(agent));
  ctx.on?.('dispose', () => states.clear());
  return {
    command(agent: Agent, parts: string[]): string {
      if (!ctx.on || !admitted(ctx.workspaceRegistry, agent.session.id) || agent.session.header.origin || agent.session.header.isSeeded) throw new Error('Live guard unavailable');
      let state = get(agent);
      if (!state) { if (states.size >= 100) throw new Error('Guard state limit'); state = new GuardState(options); states.set(agent, state); }
      if (parts[0] === 'mode' && parts.length === 2 && ['off', 'observe', 'warn'].includes(parts[1]!)) state.setMode(parts[1] as 'off'|'observe'|'warn');
      else if (parts[0] === 'delivery' && parts.length === 2 && ['model','user'].includes(parts[1]!)) state.delivery = parts[1] as 'model'|'user';
      else if (parts[0] === 'feedback' && parts.length === 3 && ['helpful', 'unnecessary', 'uncertain'].includes(parts[2]!)) {
        if (!state.recordFeedback(parts[1]!, parts[2] as 'helpful'|'unnecessary'|'uncertain')) throw new Error('Unknown decision');
      } else if (parts.length !== 1 || parts[0] !== 'status') throw new Error('Use guard status | mode off/observe/warn | feedback <id> helpful/unnecessary/uncertain');
      return JSON.stringify(state.status(), null, 2);
    },
  };
}
