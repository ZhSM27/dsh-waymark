/** Deterministic incremental guard. All identities and compact fingerprints are supplied by adapters. */
export type GuardMode = 'off' | 'observe' | 'warn';
export interface GuardOptions { failWarnMin: number; bigOutputTokens: number; maxPerSession: number; maxChars: number }
export function guardOptions(overrides: Partial<GuardOptions> = {}): GuardOptions {
  const defaults = { failWarnMin: 2, bigOutputTokens: 4000, maxPerSession: 5, maxChars: 400 };
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(key => !Object.hasOwn(defaults,key))) throw new TypeError('Invalid live configuration');
  const options = {...defaults,...overrides};
  for (const key of ['failWarnMin','maxPerSession','maxChars'] as const) if (!Number.isSafeInteger(options[key]) || options[key] < (key === 'failWarnMin' ? 2 : key === 'maxChars' ? 150 : 1)) throw new RangeError(`Invalid ${key}`);
  if (!Number.isFinite(options.bigOutputTokens) || options.bigOutputTokens < 0 || options.maxChars > 4000 || options.maxPerSession > 100) throw new RangeError('Invalid live budget');
  return options;
}
export interface GuardNotice { readonly id: number; readonly rule: 'R1'|'R3'; readonly text: string; readonly calls: readonly string[] }
export class GuardState {
  mode: GuardMode = 'off';
  generation = 0;
  delivery: 'model'|'user' = 'model';
  private chain: { key: string; error: string; count: number; calls: string[] } | undefined;
  private positions = new Map<string, string>();
  private pending = new Map<string, { key: string; generation: number; parallel: boolean }>();
  private seen = new Set<string>();
  private queue: GuardNotice[] = [];
  private warned = new Set<string>();
  private nextId = 0;
  private lastTurn: number | undefined;
  sent = 0;
  sentCharacters = 0;
  observed = { R1: 0, R3: 0 };
  feedback: Record<string, 'helpful'|'unnecessary'|'uncertain'> = {};
  readonly options;
  constructor(options: Partial<GuardOptions> = {}) { this.options = guardOptions(options); }
  reset(): void { this.generation++; this.chain = undefined; this.pending.clear(); this.queue = []; this.warned.clear(); this.positions.clear(); }
  reference(id: string, seq: number): void { if (this.positions.size < 200) this.positions.set(id, `seq ${seq}`); }
  render(notice: GuardNotice): string { return `${notice.text} 证据：${notice.calls.map(id => this.positions.get(id) ?? '本次实时调用（seq 未提交）').join('、')}`.slice(0, this.options.maxChars); }
  setMode(mode: GuardMode): void { this.reset(); this.mode = mode; }
  begin(id: string, key: string): void {
    if (this.mode === 'off') return;
    if (this.pending.size >= 200 || this.seen.size >= 2000) { this.setMode('off'); return; }
    const parallel = this.pending.size > 0;
    if (parallel) { for (const item of this.pending.values()) item.parallel = true; this.chain = undefined; }
    this.pending.set(id, { key, generation: this.generation, parallel });
  }
  settle(id: string, outcome: string, error: string | undefined, outputTokens: number): void {
    if (this.mode === 'off' || this.seen.has(id)) return;
    this.seen.add(id);
    const call = this.pending.get(id); this.pending.delete(id);
    if (!call || call.generation !== this.generation) return;
    if (outputTokens > this.options.bigOutputTokens) this.notice('R3', 'large-output', '工具输出较大。下次请按任务需要使用搜索、limit 或相关片段；必要的完整输出可以保留。', [id]);
    if (call.parallel || outcome !== 'failure' || !error) { this.chain = undefined; return; }
    const count = this.chain?.key === call.key && this.chain.error === error ? this.chain.count + 1 : 1;
    const calls = count > 1 ? [...this.chain!.calls.slice(-9), id] : [id];
    this.chain = { key: call.key, error, count, calls };
    if (count >= this.options.failWarnMin) this.notice('R1', `${call.key}:${error}`, `同一操作已连续失败 ${count} 次，参数和错误相同。请先定位错误原因，完成修正或换一种方法后再验证。`, calls);
  }
  private notice(rule: 'R1'|'R3', key: string, text: string, calls: string[]): void {
    const identity = `${rule}:${key}`;
    if (this.warned.has(identity)) return;
    this.warned.add(identity); this.observed[rule]++;
    if (this.mode === 'warn' && this.queue.length < 20) this.queue.push({ id: ++this.nextId, rule, text: `Waymark [${rule}]：${text}`.slice(0, this.options.maxChars), calls });
  }
  peek(turn: number): GuardNotice | undefined {
    return this.mode === 'warn' && this.sent < this.options.maxPerSession && this.lastTurn !== turn ? this.queue[0] : undefined;
  }
  delivered(turn: number): void { const notice = this.queue.shift(); if (notice) { this.sentCharacters += this.render(notice).length; this.sent++; this.lastTurn = turn; } }
  recordFeedback(id: string, value: 'helpful'|'unnecessary'|'uncertain'): boolean {
    if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > this.nextId || Object.keys(this.feedback).length >= 100) return false;
    this.feedback[id] = value; return true;
  }
  status() { return { mode: this.mode, delivery: this.delivery, observed: { ...this.observed }, sent: this.sent, pendingNotices: this.queue.length,
    estimatedNoticeTokens: this.sentCharacters / 4, notices: this.queue.map(notice => ({id:notice.id,rule:notice.rule,text:this.render(notice)})), feedback: { ...this.feedback } }; }
}
