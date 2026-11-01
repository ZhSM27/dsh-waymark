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
  await runtime.mount(await import(pathToFileURL(entry).href));
  const sessions = await runtime.ctx.sessionQuery.listSessions();
  const selected = sessions.filter(item => item.persisted && !item.header.origin).sort((a,b) => b.header.createdAt-a.header.createdAt)[0];
  if (!selected) throw new Error('No saved sessions');
  // A standalone receiving Session: command lifecycle stays in RAM, not in original logs.
  const receiver = runtime.Session.create('waymark-validation');
  const execution = await runtime.ctx.commands.execute({ session: receiver }, `/waymark retro ${selected.header.id}`, [], new AbortController().signal);
  if (execution?.result.kind !== 'success') throw new Error('Native command did not succeed');
  await mkdir('.research', { recursive: true });
  await writeFile('.research/phase2-real-report.txt', execution.result.text);
  const safe = execution.result.text.replace(selected.header.id, 'local-session-redacted');
  await writeFile('.research/phase2-redacted-report.txt', safe);
  const unchanged = before === await sourceDigest(root);
  if (!unchanged) throw new Error('Source logs changed');
  console.log(JSON.stringify({ dsh:'0.2.1-rc.5', savedSessions:sessions.filter(item=>item.persisted&&!item.header.origin).length,
    nativeCommand:execution.result.kind, sourceUnchanged:unchanged, receivingLifecycleEvents:receiver.seq }));
} catch(error) {
  await mkdir('.research', { recursive: true });
  await writeFile('.research/phase2-error.txt', String(error?.stack ?? error));
  console.error('Integration failed; details kept private in .research/phase2-error.txt');
  process.exitCode=1;
} finally { await runtime?.close(); }
