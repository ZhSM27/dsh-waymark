import test from 'node:test';
import assert from 'node:assert/strict';
import { countEvents } from '../scripts/probe-session.mjs';

test('empty log has explicit zero counts', () => {
  assert.deepEqual(countEvents([]), { user: 0, assistant: 0, tool_call: 0, tool_result: 0, other: 0 });
});
test('counts canonical categories without inspecting private bodies', () => {
  const events = ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'tool/result'].map(type => ({ type }));
  assert.deepEqual(countEvents(events), { user: 1, assistant: 1, tool_call: 1, tool_result: 2, other: 0 });
});
test('log-only and unknown records are retained in total accounting', () => {
  assert.deepEqual(countEvents([{ type: 'turn/start' }, { type: 'plugin:synthetic/event' }]),
    { user: 0, assistant: 0, tool_call: 0, tool_result: 0, other: 2 });
});
