import assert from 'node:assert/strict';
import { analyzeSession, renderReport } from '../lib/core/index.js';
import { failureLoop, productiveIteration } from './fixtures/sessions.mjs';

const loop = analyzeSession(failureLoop());
assert.equal(loop.findings[0].rule, 'R1');
assert.match(renderReport(loop), /seq 0–5/);
assert.deepEqual(analyzeSession(productiveIteration()).findings, []);
console.log('Built ESM core: failure detection, evidence rendering and productive iteration passed.');
