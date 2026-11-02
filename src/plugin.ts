import { adaptDshSession } from './adapters/dsh.ts';
import type { DshSnapshot } from './adapters/dsh.ts';
import { analyzeSession, renderReport, renderMarkdown, resolveConfig } from './core/index.ts';
import type { Config } from './core/index.ts';
import { exportMarkdown } from './host/export.ts';
import { admitted, candidates, type WorkspaceRegistry } from './host/session-policy.ts';
import { installGuard, type LiveContext } from './host/guard-runtime.ts';
import type { GuardOptions } from './core/guard.ts';

export const name = 'waymark';
export const inject = ['commands', 'sessionQuery', 'workspaceRegistry'];

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
export interface Services extends LiveContext {
  readonly workspaceRegistry?: WorkspaceRegistry;
  readonly commands: { register(definition: { name: string; description: string; input: { hint: string }; handler: (invocation: Invocation) => Promise<{ kind: 'success' | 'error'; text: string }> }): () => void };
  readonly sessionQuery: { listSessions(signal?: AbortSignal): Promise<readonly SessionRecord[]>; readSession(id: string): Promise<DshSnapshot> };
}

export function apply(ctx: Services, overrides: Partial<Config> & {live?: Partial<GuardOptions>} = {}): void {
  const {live, ...offline} = overrides;
  const config = resolveConfig(offline);
  const guard = installGuard(ctx, {bigOutputTokens:config.bigOutputTokens,...live});
  ctx.commands.register({
    name: 'waymark', description: 'Local evidence-grounded workflow diagnostics; no model request',
    input: { hint: 'retro [session-id | last] [--json | --markdown | --export report.md] | guard status/mode/delivery/feedback' },
    async handler(invocation) {
      try {
        invocation.signal.throwIfAborted();
        const parts = invocation.rawInput.trim().split(/\s+/).filter(Boolean);
        if (parts[0] === 'guard') { parts.shift(); return { kind: 'success', text: guard.command(invocation.agent, parts) }; }
        if (!admitted(ctx.workspaceRegistry, invocation.agent.session.id)) return {kind:'error',text:'Waymark unavailable: session archive/workspace status is not eligible.'};
        const usage='Usage: /waymark retro [session-id | last] [--json | --markdown | --export report.md]';
        if (parts.shift() !== 'retro') return { kind: 'error', text: usage };
        let id=parts[0]&&!parts[0].startsWith('--')?parts.shift()!:invocation.agent.session.id;
        const mode=parts.shift();
        const filename=mode==='--export'?parts.shift():undefined;
        if(parts.length||mode&&!['--json','--markdown','--export'].includes(mode)||mode==='--export'&&!filename) return {kind:'error',text:usage};
        if (id === 'last') {
          const cwd = invocation.agent.session.header.cwd;
          if (!cwd) return { kind: 'error', text: 'No workspace metadata; pass an explicit session id.' };
          const sessions = [];
          for (const candidate of candidates(ctx.workspaceRegistry, cwd)) {
            invocation.signal.throwIfAborted();
            if (candidate === invocation.agent.session.id || !admitted(ctx.workspaceRegistry,candidate)) continue;
            const snapshot = await ctx.sessionQuery.readSession(candidate);
            if (!admitted(ctx.workspaceRegistry,candidate)) throw new Error('Archive status changed');
            const header = snapshot.session as typeof snapshot.session & {origin?:string;createdAt?:number};
            if (!snapshot.inheritedEventCount && !header.origin && !header.isSeeded && header.cwd === cwd && typeof header.createdAt === 'number') sessions.push({header:{...header,createdAt:header.createdAt}});
          }
          const selected = sessions.sort((a, b) => b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id))[0];
          if (!selected) return { kind: 'error', text: 'No earlier saved top-level session in this workspace.' };
          id = selected.header.id;
        }
        if (!admitted(ctx.workspaceRegistry,id)) return {kind:'error',text:'Waymark excludes archived or unregistered sessions.'};
        const snapshot = await ctx.sessionQuery.readSession(id);
        if (!admitted(ctx.workspaceRegistry,id)) throw new Error('Archive status changed');
        invocation.signal.throwIfAborted();
        if (!admitted(ctx.workspaceRegistry,id)) throw new Error('Archive status changed');
        const adapted = adaptDshSession(snapshot);
        const analysis = analyzeSession(adapted.input, config);
        const report={...analysis,issues:[...analysis.issues,...adapted.issues]};
        invocation.signal.throwIfAborted();
        if(mode==='--json') return {kind:'success',text:JSON.stringify(report,null,2)};
        if(mode==='--markdown') return {kind:'success',text:renderMarkdown(report)};
        if(mode==='--export') {
          const cwd=invocation.agent.session.header.cwd;
          if(!cwd) return {kind:'error',text:'No workspace metadata; Markdown export unavailable.'};
          const target=await exportMarkdown(cwd,filename!,renderMarkdown(report),invocation.signal);
          return {kind:'success',text:`Markdown exported locally: ${target}`};
        }
        return { kind: 'success', text: renderReport(report) };
      } catch(error) {
        const code=(error as {code?:string}|null)?.code;
        return { kind: 'error', text: invocation.signal.aborted ? 'Waymark cancelled.' : code==='EEXIST'
          ? 'Export target already exists. Choose a new report filename.'
          : 'Waymark could not complete the operation. Check session id, format, compatibility and export filename/permissions; raw session diagnostics are not printed.' };
      }
    },
  });
}
