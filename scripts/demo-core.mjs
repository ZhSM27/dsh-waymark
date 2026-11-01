// Public demonstration uses independently authored synthetic events only.
import { analyzeSession, renderReport } from '../lib/core/index.js';
import { builder } from '../test/fixtures/sessions.mjs';

const b = builder();
b.add({ kind: 'user', source: 'human', text: 'Run the synthetic check.' });
for (let i = 0; i < 4; i++) {
  b.attempt({ command: 'example-check' }, { turn: i + 1, tokens: 12 },
    { turn: i + 1, text: 'Synthetic configuration error', tokens: 40 });
}
b.attempt({ command: 'example-list' }, { tool: 'list', tokens: 8 },
  { outcome: 'success', text: 'Synthetic output', tokens: 5000 });
console.log('以下为合成演示，不是实际会话分析结果。\n');
console.log(renderReport(analyzeSession(b.session())));
