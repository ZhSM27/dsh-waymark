// Phase 0 research probe, not the production adapter. Never prints message bodies.
import { readdir, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function countEvents(events) {
  const counts = { user: 0, assistant: 0, tool_call: 0, tool_result: 0, other: 0 };
  const types = { 'user/message': 'user', 'assistant/message': 'assistant', 'tool/call': 'tool_call', 'tool/result': 'tool_result' };
  for (const event of events) counts[types[event.type] ?? 'other']++;
  return counts;
}

export async function sourceDigest(root) {
  const hash = createHash('sha256');
  async function visit(dir) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Refusing linked session artifacts');
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(entry.name)) {
        hash.update(path); hash.update(await readFile(path));
      }
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function installedPackage(name) {
  const store = resolve('.research/node_modules/.pnpm');
  const prefix = `${name.replace('/', '+')}@0.2.1-rc.5`;
  const candidates = (await readdir(store)).filter(entry => entry.startsWith(prefix));
  if (candidates.length !== 1) throw new Error('Research package missing or ambiguous');
  return join(store, candidates[0], 'node_modules', name);
}

export async function probe(root, id) {
  const cliRequire = createRequire(await realpath(resolve('.research/node_modules/@deepseek-ai/dsh/package.json')));
  const { Context } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/cordis')).href);
  const backendRoot = await installedPackage('@deepseek-ai/dsh-session-persistence-jsonl');
  const backend = await import(pathToFileURL(join(backendRoot, 'lib/index.js')).href);
  const ctx = new Context();
  let handle;
  let backendFiber;
  try {
    const before = await sourceDigest(resolve(root));
    backendFiber = ctx.plugin(backend, { root: resolve(root), compression: 'zstd', listConcurrency: 3 });
    await backendFiber.await();
    const persistence = ctx.get('sessionPersistence');
    const snapshots = await persistence.list();
    const candidates = snapshots.filter(item => !item.header.origin);
    const selected = id ? snapshots.find(item => item.header.id === id)
      : candidates.sort((a, b) => b.header.createdAt - a.header.createdAt)[0];
    if (!selected) throw new Error('No matching saved session');
    handle = await persistence.open(selected.header.id, 'read');
    const { events } = await handle.read(0);
    const result = {
      dshVersion: '0.2.1-rc.5',
      logicalFormatVersion: handle.header.version,
      total: events.length,
      counts: countEvents(events),
      sourceUnchanged: before === await sourceDigest(resolve(root)),
    };
    if (!result.sourceUnchanged) throw new Error('Source changed during observation');
    return result;
  } finally {
    try { if (handle) await handle.close(); }
    finally { if (backendFiber) await backendFiber.dispose(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, id] = process.argv.slice(2);
  if (!root) {
    console.error('Usage: node scripts/probe-session.mjs <sessions-root> [session-id]');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await probe(root, id), null, 2)); }
    catch (error) {
      // Upstream errors can contain raw paths or body fragments: keep those private.
      console.error(JSON.stringify({ error: error?.name ?? 'Error', message: 'Read-only probe failed; inspect locally without publishing raw diagnostics.' }));
      if (process.env.WAYMARK_PRIVATE_DIAGNOSTICS === '1') {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(resolve('.research/probe-error.txt'), String(error?.stack ?? error));
      }
      process.exitCode = 1;
    }
  }
}
