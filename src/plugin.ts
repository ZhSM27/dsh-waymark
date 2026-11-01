import { adaptDshSession } from './adapters/dsh.ts';
import type { DshSnapshot } from './adapters/dsh.ts';
import { analyzeSession, renderReport, resolveConfig } from './core/index.ts';
import type { Config } from './core/index.ts';

export const name = 'waymark';
export const inject = ['commands', 'sessionQuery'];

/** Only the verified public service subset is used; no runtime dsh imports. */
export interface Invocation {
  readonly agent: { readonly session: { readonly id: string; readonly header: { readonly cwd?: string } } };
  readonly rawInput: string;
  readonly signal: AbortSignal;
}
interface SessionRecord {
  readonly header: { readonly id: string; readonly cwd?: string; readonly createdAt: number; readonly origin?: string };
  readonly persisted: boolean;
}
export interface Services {
  readonly commands: { register(definition: { name: string; description: string; input: { hint: string }; handler: (invocation: Invocation) => Promise<{ kind: 'success' | 'error'; text: string }> }): () => void };
  readonly sessionQuery: { listSessions(signal?: AbortSignal): Promise<readonly SessionRecord[]>; readSession(id: string): Promise<DshSnapshot> };
}

export function apply(ctx: Services, overrides: Partial<Config> = {}): void {
  const config = resolveConfig(overrides);
  ctx.commands.register({
    name: 'waymark', description: 'Local evidence-grounded workflow diagnostics; no model request',
    input: { hint: 'retro [session-id | last]' },
    async handler(invocation) {
      try {
        invocation.signal.throwIfAborted();
        const parts = invocation.rawInput.trim().split(/\s+/).filter(Boolean);
        if (parts[0] !== 'retro' || parts.length > 2) return { kind: 'error', text: 'Usage: /waymark retro [session-id | last]' };
        let id = parts[1] ?? invocation.agent.session.id;
        if (id === 'last') {
          const cwd = invocation.agent.session.header.cwd;
          if (!cwd) return { kind: 'error', text: 'No workspace metadata; pass an explicit session id.' };
          const sessions = await ctx.sessionQuery.listSessions(invocation.signal);
          const selected = sessions.filter(session => session.persisted && !session.header.origin && session.header.cwd === cwd
            && session.header.id !== invocation.agent.session.id)
            .sort((a, b) => b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id))[0];
          if (!selected) return { kind: 'error', text: 'No earlier saved top-level session in this workspace.' };
          id = selected.header.id;
        }
        const snapshot = await ctx.sessionQuery.readSession(id);
        invocation.signal.throwIfAborted();
        const adapted = adaptDshSession(snapshot);
        const report = analyzeSession(adapted.input, config);
        return { kind: 'success', text: renderReport({ ...report, issues: [...report.issues, ...adapted.issues] }) };
      } catch {
        return { kind: 'error', text: invocation.signal.aborted ? 'Waymark cancelled.' : 'Waymark could not read or validate the session. Check id, format and dsh compatibility; raw session diagnostics are not printed.' };
      }
    },
  });
}
