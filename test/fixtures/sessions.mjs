// Independently authored synthetic data. No captured sessions or private paths.
export function session(events = [], id = 'synthetic-session') {
  return { id, scope: 'full-log', events };
}

export function builder() {
  const events = [];
  let nextId = 0;
  function add(event) {
    const position = { seq: events.length, turn: 1, step: 1 };
    const value = { ...position, ...event };
    events.push(value);
    return value;
  }
  function call(args = { command: 'example-check' }, options = {}) {
    return add({ kind: 'tool_call', id: `synthetic-call-${++nextId}`, tool: 'shell', args, ...options });
  }
  function result(invocation, options = {}) {
    return add({ kind: 'tool_result', callId: invocation.id, outcome: 'failure',
      outcomeSource: 'structured', text: 'Synthetic check failed', ...options });
  }
  function attempt(args, callOptions, resultOptions) {
    const invocation = call(args, callOptions);
    return { call: invocation, result: result(invocation, resultOptions) };
  }
  return { events, add, call, result, attempt, session: () => session(events) };
}

export function failureLoop(count = 3) {
  const b = builder();
  for (let i = 0; i < count; i++) b.attempt();
  return b.session();
}

export function productiveIteration() {
  const b = builder();
  for (let i = 0; i < 4; i++) {
    b.attempt();
    b.attempt({ file: 'sample.txt', change: 'synthetic correction' }, { tool: 'edit' }, { outcome: 'success', text: 'Updated example' });
  }
  b.attempt(undefined, undefined, { outcome: 'success', text: 'Example passed' });
  return b.session();
}
