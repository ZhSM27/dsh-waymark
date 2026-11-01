import type { Evidence, Finding, Report, TokenSize } from './types.ts';

function safeInline(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 160);
}

function sizeText(size: TokenSize): string {
  if (size.value === null) return '不可用';
  const number = size.value >= 1000 ? `${(size.value / 1000).toFixed(1)}k` : `${Math.round(size.value)}`;
  return `${size.method === 'reported' ? '' : '约 '}${number} token${size.method === 'reported' ? '（内容计数）' : '（估算）'}`;
}

function percent(value: number | null): string { return value === null ? '比例不可用' : `${(value * 100).toFixed(1)}%`; }

function range(evidence: readonly Evidence[]): string {
  const turns = evidence.flatMap(item => item.turn === null ? [] : [item.turn]);
  const seqs = evidence.map(item => item.seq);
  const min = (values: number[]) => values.reduce((result, value) => Math.min(result, value), Infinity);
  const max = (values: number[]) => values.reduce((result, value) => Math.max(result, value), -Infinity);
  const turnRange = turns.length === 0 ? '轮次未知' : `第 ${min(turns)}${min(turns) === max(turns) ? '' : `–${max(turns)}`} 轮`;
  return `${turnRange} · seq ${min(seqs)}–${max(seqs)}`;
}

function renderFinding(finding: Finding): string[] {
  const titles={R1:'重复失败',R2:'重复读取',R3:'巨型输出',R4:'用户纠偏'};
  const heading = `[${finding.rule} ${titles[finding.rule]}] ${range(finding.evidence)}`;
  const body = finding.rule === 'R1' ? [
    `  ${safeInline(finding.tool)} 连续失败 ${finding.attempts} 次，参数${finding.match === 'exact' ? '相同' : finding.match === 'normalized' ? '归一化后相同' : '相似'}，错误标识或文本相同。`,
    `  首次之后的重复调用与输出：${sizeText(finding.repeatedContent)}。`,
  ] : finding.rule==='R2'?[
    `  ${safeInline(finding.path)} 同一范围读取 ${finding.reads} 次；${finding.sameContentVerified?'返回内容一致':'返回内容一致性未知'}。`,
    `  首次之后的重复调用与输出：${sizeText(finding.repeatedContent)}。`,
  ] : finding.rule==='R4'?[
    `  命中纠偏词“${safeInline(finding.keyword)}”；用户消息前 80 字符：${safeInline(finding.excerpt)}`,
  ] : [
    `  ${safeInline(finding.output.tool ?? '未配对工具')} 输出 ${sizeText(finding.output.size)}；占本次分析内容体积 ${percent(finding.output.sessionContentRatio)}。`,
  ];
  return [heading, ...body, `  置信度：${{high:'高',medium:'中',low:'低'}[finding.confidence]}（指发现事实，非浪费结论）。`,
    `  建议规则：${finding.suggestion}`, ...finding.limitations.map(note => `  边界：${note}`)];
}

export function renderMarkdown(report:Report):string {
  const body=renderReport(report,{maxFindings:Number.MAX_SAFE_INTEGER});
  const longest=(body.match(/`+/g)??[]).reduce((max,run)=>Math.max(max,run.length),2);
  const fence='`'.repeat(longest+1);
  return `# Waymark 复盘报告\n\n${fence}text\n${body}\n${fence}\n`;
}

/** Pure plain-text rendering: no I/O, model calls, or session mutations. */
export function renderReport(report: Report, options: { maxFindings?: number } = {}): string {
  const max = options.maxFindings ?? 3;
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('Invalid maxFindings');
  const lines = [
    `Waymark · 会话 ${safeInline(report.sessionId)} · 共 ${report.turns} 轮`,
    `范围：${report.scope === 'full-log' ? '完整历史（非当前上下文快照）' : '当前模型可见内容'}。`,
    `发现 ${report.findings.length} 项；疑似可避免的重复内容：${sizeText(report.suspectedAvoidableContent)}，占分析内容体积 ${percent(report.suspectedAvoidableRatio)}。`,
    `工具调用 ${report.audit.toolCalls} 次：成功 ${report.audit.outcomes.success}，明确失败 ${report.audit.outcomes.failure}，未知 ${report.audit.outcomes.unknown}，中断 ${report.audit.outcomes.interrupted}，未解决 ${report.audit.outcomes.unresolved}。`,
    '以上体积不等同于实际节省的请求 token；大输出不直接计入可避免总额。',
  ];
  for (const finding of report.findings.slice(0, max)) lines.push('', ...renderFinding(finding));
  if (report.findings.length > max) lines.push('', `其余 ${report.findings.length - max} 项未展开，可提高 maxFindings 查看。`);
  if (report.topOutputs.length) {
    lines.push('', '工具输出体积排行（包含未超过阈值的输出）：');
    for (const output of report.topOutputs) {
      lines.push(`  seq ${output.position.seq} · ${safeInline(output.tool ?? '未配对工具')} · ${sizeText(output.size)} · ${percent(output.sessionContentRatio)}`);
    }
  }
  lines.push('', `模型请求用量：${sizeText(report.requestUsage)}；覆盖 ${report.requestUsageCoverage.reported}/${report.requestUsageCoverage.assistantMessages} 条助手消息，单独统计。`);
  if(report.audit.verification.length) {
    lines.push('', '已观察到的验证命令（仅覆盖已识别的命令形式）：');
    for(const item of report.audit.verification) lines.push(`  ${item.kind} · seq ${item.position.seq} · ${item.outcome}`);
  }
  if(report.proposals.length) {
    lines.push('','AGENTS.md 项目级候选规则（请先审核，未自动采纳）：');
    for(const proposal of report.proposals) lines.push(`  - ${proposal.text} [依据 ${proposal.sourceFindingIds.join(', ')}]`);
  }
  for (const issue of report.issues) lines.push(`数据边界：${issue}`);
  return lines.join('\n');
}
