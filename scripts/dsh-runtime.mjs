// Local validation only. Loads the pinned research packages, not production dependencies.
import { readdir, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export async function researchModule(name) {
  const store = resolve('.research/node_modules/.pnpm');
  const candidates = (await readdir(store)).filter(entry => entry.startsWith(`${name.replace('/', '+')}@0.2.1-rc.5`));
  if (candidates.length !== 1) throw new Error('Pinned research package unavailable');
  const require = createRequire(join(store, candidates[0], 'node_modules', name, 'package.json'));
  return import(pathToFileURL(require.resolve(name)).href);
}

export async function openRuntime(root) {
  const require = createRequire(await realpath(resolve('.research/node_modules/@deepseek-ai/dsh/package.json')));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const [{ SessionStore, Session }, backend, { SqliteSessionQueryEngine }, { CommandRuntime }] = await Promise.all([
    researchModule('@deepseek-ai/dsh-session'), researchModule('@deepseek-ai/dsh-session-persistence-jsonl'),
    researchModule('@deepseek-ai/dsh-session-query-sqlite'), researchModule('@deepseek-ai/dsh-commands'),
  ]);
  const ctx = new Context(), fibers = [];
  async function mount(plugin, config) { const fiber = ctx.plugin(plugin, config); fibers.push(fiber); await fiber.await(); return fiber; }
  async function close() { for (const fiber of fibers.reverse()) await fiber.dispose(); }
  try {
    await mount(SessionStore);
    await mount(backend, { root: resolve(root), compression: 'zstd', listConcurrency: 3 });
    await mount(SqliteSessionQueryEngine, { path: ':memory:', openAt: 'never' });
    await mount(CommandRuntime);
    return { ctx, mount, close, Session };
  } catch(error) { await close(); throw error; }
}
