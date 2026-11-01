import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { openRuntime } from './dsh-runtime.mjs';
import { sourceDigest } from './probe-session.mjs';

const root = process.argv[2];
let runtime;
try {
  if (!root) throw new Error('Pass explicit sessions root');
  const before = await sourceDigest(root);
  runtime = await openRuntime(root);
  const entry = process.argv[3] ? createRequire(resolve(process.argv[3], 'package.json')).resolve('dsh-waymark') : resolve('lib/plugin.js');
  const pluginFiber=await runtime.mount(await import(pathToFileURL(entry).href));
  const sessions = await runtime.ctx.sessionQuery.listSessions();
  const selected = sessions.filter(item => item.persisted && !item.header.origin).sort((a,b) => b.header.createdAt-a.header.createdAt)[0];
  if (!selected) throw new Error('No saved sessions');
  // A standalone receiving Session: command lifecycle stays in RAM, not in original logs.
  const cwd=resolve('.research/integration-workspace');await mkdir(cwd,{recursive:true});
  const receiver = runtime.Session.create('waymark-validation',[],{id:'waymark-validation',version:4,createdAt:Date.now(),cwd,isSeeded:false});
  const agent={session:receiver},signal=new AbortController().signal;
  const execution = await runtime.ctx.commands.execute(agent, `/waymark retro ${selected.header.id}`, [], signal);
  if (execution?.result.kind !== 'success') throw new Error('Native command did not succeed');
  const json=await runtime.ctx.commands.execute(agent,`/waymark retro ${selected.header.id} --json`,[],signal);
  if(json?.result.kind!=='success'||JSON.parse(json.result.text).schemaVersion!=='0.1')throw new Error('Native JSON mode failed');
  const markdown=await runtime.ctx.commands.execute(agent,`/waymark retro ${selected.header.id} --markdown`,[],signal);
  if(markdown?.result.kind!=='success'||!markdown.result.text.startsWith('# Waymark'))throw new Error('Native Markdown mode failed');
  const exported=await runtime.ctx.commands.execute(agent,`/waymark retro ${selected.header.id} --export real-session-${Date.now()}.md`,[],signal);
  if(exported?.result.kind!=='success')throw new Error('Native export mode failed');
  await mkdir('.research', { recursive: true });
  await writeFile('.research/phase2-real-report.txt', execution.result.text);
  const safe = execution.result.text.replace(selected.header.id, 'local-session-redacted');
  await writeFile('.research/phase2-redacted-report.txt', safe);
  const unchanged = before === await sourceDigest(root);
  if (!unchanged) throw new Error('Source logs changed');
  await pluginFiber.dispose();
  const afterUnload=await runtime.ctx.commands.execute(agent,'/waymark retro',[],signal);
  if(afterUnload!==undefined)throw new Error('Command survived plugin unload');
  console.log(JSON.stringify({ dsh:'0.2.1-rc.5', savedSessions:sessions.filter(item=>item.persisted&&!item.header.origin).length,
    nativeCommand:execution.result.kind,json:true,markdown:true,explicitExport:true,unload:true,sourceUnchanged:unchanged, receivingLifecycleEvents:receiver.seq }));
} catch(error) {
  await mkdir('.research', { recursive: true });
  await writeFile('.research/phase2-error.txt', String(error?.stack ?? error));
  console.error('Integration failed; details kept private in .research/phase2-error.txt');
  process.exitCode=1;
} finally { await runtime?.close(); }
