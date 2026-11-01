import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {openRuntime} from './dsh-runtime.mjs';
import {sourceDigest} from './probe-session.mjs';
import {adaptDshSession} from '../src/adapters/dsh.ts';
import {analyzeSession,renderReport,DEFAULT_CONFIG} from '../src/core/index.ts';
import {summarizeReview} from '../src/core/review.ts';

const root=process.argv[2],output=resolve(process.argv[3]??'.research/review/baseline');
let runtime;
try {
  if(!root)throw new Error('Pass explicit sessions root');
  const privateRoot=resolve('.research');
  if(!output.startsWith(privateRoot+sep))throw new Error('Evaluation must remain under .research');
  const before=await sourceDigest(root);
  runtime=await openRuntime(root);
  const records=(await runtime.ctx.sessionQuery.listSessions()).filter(item=>item.persisted&&!item.header.origin)
    .sort((a,b)=>b.header.createdAt-a.header.createdAt||a.header.id.localeCompare(b.header.id)).slice(0,10);
  const rows=[],summaries=[],controls=[];
  await mkdir(output,{recursive:true});
  for(const [index,item]of records.entries()) {
    const alias=`s${String(index+1).padStart(2,'0')}`;
    const snapshot=await runtime.ctx.sessionQuery.readSession(item.header.id);
    const adapted=adaptDshSession(snapshot);
    const analysis=analyzeSession(adapted.input);
    const report={...analysis,issues:[...analysis.issues,...adapted.issues]};
    await writeFile(resolve(output,`${alias}-report.md`),renderReport(report,{maxFindings:Number.MAX_SAFE_INTEGER}),{flag:'wx'});
    for(const finding of report.findings) {
      rows.push({id:`${alias}:${finding.id}`,session:alias,rule:finding.rule,confidence:finding.confidence,
        evidence:finding.evidence,description:finding.rule==='R1'?`${finding.tool}: ${finding.attempts} failed attempts`:
          finding.rule==='R2'?`${finding.path}: ${finding.reads} reads`:finding.rule==='R3'?`${finding.output.size.value} content tokens (${finding.output.size.method})`:finding.excerpt,
        suggestion:finding.suggestion,decision:null,comment:''});
    }
    summaries.push({alias,sessionId:item.header.id,turns:report.turns,findings:report.findings.length,
      rules:Object.fromEntries(['R1','R2','R3','R4'].map(rule=>[rule,report.findings.filter(f=>f.rule===rule).length])),
      adapterIssues:adapted.issues});
    const covered=new Set(report.findings.flatMap(f=>f.evidence.map(e=>e.seq)));
    const candidates=adapted.input.events.filter(e=>e.kind==='tool_call'&&!covered.has(e.seq));
    for(const sample of [candidates[0],candidates[Math.floor(candidates.length/2)]].filter(Boolean)) {
      const window=adapted.input.events.filter(e=>e.seq>=sample.seq-2&&e.seq<=sample.seq+4);
      controls.push({id:`${alias}:control:${sample.seq}`,session:alias,decision:null,
        events:window.map(e=>({seq:e.seq,turn:e.turn,kind:e.kind,
          excerpt:(e.kind==='tool_call'?`${e.tool} ${e.argsText??JSON.stringify(e.args)}`:'text'in e?e.text??'':'').slice(0,240)}))});
    }
  }
  const unchanged=before===await sourceDigest(root);
  if(!unchanged)throw new Error('Source logs changed during evaluation');
  await writeFile(resolve(output,'review.json'),JSON.stringify(rows,null,2),{flag:'wx'});
  await writeFile(resolve(output,'controls.json'),JSON.stringify(controls,null,2),{flag:'wx'});
  await writeFile(resolve(output,'manifest.json'),JSON.stringify({dshVersion:'0.2.1-rc.5',requestedSessions:10,analyzedSessions:records.length,
    config:DEFAULT_CONFIG,sourceUnchanged:unchanged,sessions:summaries,review:summarizeReview(rows)},null,2),{flag:'wx'});
  const cell=value=>String(value).replaceAll('|','\\|').replace(/[\r\n]/g,' ');
  const table=['# Waymark 本地人工评议','',
    '含真实会话派生信息，仅保留本地。逐项将 review.json 的 decision 改成 agree / disagree / uncertain；null 表示未评议。不得把工程验收认可当作发现认同。',
    '',`已分析 ${records.length}/10 个会话，发现 ${rows.length} 项。controls.json 是未报告片段抽查，供检查漏报。`,
    '','| ID | 规则 | 证据 seq | 发现 | 我是否认同 |','|---|---|---|---|---|',
    ...rows.map(row=>`| ${cell(row.id)} | ${row.rule} | ${row.evidence.map(e=>e.seq).join(', ')} | ${cell(row.description)} | 待评议 |`)];
  await writeFile(resolve(output,'review.md'),table.join('\n'),{flag:'wx'});
  console.log(JSON.stringify({analyzedSessions:records.length,findings:rows.length,controls:controls.length,sourceUnchanged:unchanged,
    review:summarizeReview(rows),privateOutput:relative(resolve('.'),output)}));
}catch(error){
  await mkdir('.research',{recursive:true});await writeFile('.research/evaluation-error.txt',String(error?.stack??error));
  console.error('Evaluation failed; private details retained under .research');process.exitCode=1;
}finally{await runtime?.close();}
