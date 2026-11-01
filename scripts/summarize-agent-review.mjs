import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadArchivePolicy} from './archive-policy.mjs';
const directory=process.argv[2];if(!directory)throw new Error('Pass checked review directory');
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
const policy=await loadArchivePolicy(manifest.metadataPath);
if(policy.digest!==manifest.metadataDigest||manifest.sources.some(source=>!policy.allowed.has(source.id)))throw new Error('Review scope invalidated');
const packet=JSON.parse(await readFile(resolve(directory,'agent-packet.json'),'utf8'));
const a=JSON.parse(await readFile(resolve(directory,'judgment-a.json'),'utf8'));
const b=JSON.parse(await readFile(resolve(directory,'judgment-b.json'),'utf8'));
const controlRows=a.controls??[],candidateRows=[...(a.candidates??[]),...(b.candidates??[])];
function validate(expected,rows){
  const ids=new Set(expected.map(row=>row.id));
  if(rows.length!==ids.size||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!ids.has(row.id)||!['actionable-miss','legitimate-iteration','insufficient-evidence'].includes(row.verdict)))throw new Error('Incomplete or duplicate agent judgments');
}
validate(packet.controls,controlRows);validate(packet.candidates,candidateRows);
const counts=rows=>Object.fromEntries(['actionable-miss','legitimate-iteration','insufficient-evidence'].map(key=>[key,rows.filter(row=>row.verdict===key).length]));
const summary={judgmentSource:'subagents; not user-agreement labels',scope:'unarchived-only',eligibleSessions:manifest.eligibleSessions,
  archivedExcluded:manifest.archiveExcluded,unsupportedHeadersExcluded:manifest.skipped.unknownHeader,
  controls:{total:controlRows.length,...counts(controlRows)},candidates:{total:candidateRows.length,...counts(candidateRows),duplicateWindows:candidateRows.filter(row=>row.duplicateOf).length},
  afterMarkedDuplicates:{records:candidateRows.filter(row=>!row.duplicateOf).length,...counts(candidateRows.filter(row=>!row.duplicateOf))},
  limitations:['Candidates and neighboring windows are not independent statistical samples','R4 miss is low-confidence semantic coverage only, not a proven contract violation','No global accuracy/recall or human-agreement ratio is inferred']};
await writeFile(resolve(directory,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
const cell=value=>String(value??'').replaceAll('|','\\|').replace(/[\r\n]/g,' ');
const md=['# 未归档会话子代理复核','', '仅使用通过归档范围校验的窗口；以下为子代理判断，不是人工认同比例。','',
  '| 类型 | ID | 判定 | 规则 | 置信度 | 证据 seq | 理由 | 重叠于 |','|---|---|---|---|---|---|---|---|',
  ...[...controlRows.map(row=>({...row,type:'对照'})),...candidateRows.map(row=>({...row,type:'候选'}))]
    .map(row=>`| ${row.type} | ${cell(row.id)} | ${cell(row.verdict)} | ${cell(row.potentialRule)} | ${cell(row.confidence)} | ${cell(row.evidenceSeqs?.join(', '))} | ${cell(row.reason)} | ${cell(row.duplicateOf)} |`)];
await writeFile(resolve(directory,'review.md'),md.join('\n'),{flag:'wx'});
console.log(JSON.stringify(summary));
