import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {openRuntime} from './dsh-runtime.mjs';
import {adaptDshSession} from '../src/adapters/dsh.ts';
const root=process.argv[2],directory=resolve(process.argv[3]??'.research/review/baseline');
if(!root||!directory.startsWith(resolve('.research')+sep))throw new Error('Use explicit sessions root and private output directory');
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
const rows=JSON.parse(await readFile(resolve(directory,'review.json'),'utf8'));
const runtime=await openRuntime(root);
function excerpt(value) {
  const body=String(value).replace(/Bearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi,'[redacted]');
  return body.length>1200?`${body.slice(0,600)}\n[片段省略]\n${body.slice(-600)}`:body;
}
try {
  for(const item of manifest.sessions) {
    const selected=rows.filter(row=>row.session===item.alias);
    if(!selected.length)continue;
    const {input}=adaptDshSession(await runtime.ctx.sessionQuery.readSession(item.sessionId));
    const output=['# 本地评议证据','', '真实内容节选，可能含私人信息，仅保留本地。提示是否有用需结合任务目标判断。',''];
    for(const row of selected) {
      output.push(`## ${row.id}`,'');
      const first=Math.min(...row.evidence.map(e=>e.seq));
      const user=input.events.filter(e=>e.seq<=first&&e.kind==='user'&&e.source==='human').at(-1);
      if(user)output.push('最近用户目标：', '~~~text',excerpt(user.text),'~~~','');
      const ids=new Set(row.evidence.map(e=>e.seq));
      for(const event of input.events.filter(e=>ids.has(e.seq)).slice(0,10)) {
        const body=event.kind==='tool_call'?`${event.tool}\n${event.argsText??JSON.stringify(event.args)}`:'text'in event?event.text??'':'';
        output.push(`seq ${event.seq} · ${event.kind}`,'~~~text',excerpt(body).replaceAll('~~~','~ ~ ~'),'~~~','');
      }
    }
    await writeFile(resolve(directory,`${item.alias}-evidence.md`),output.join('\n'),{flag:'wx'});
  }
  console.log(JSON.stringify({privateEvidenceFiles:manifest.sessions.filter(s=>rows.some(row=>row.session===s.alias)).length}));
}finally{await runtime.close();}
