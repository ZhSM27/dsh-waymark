import test from 'node:test';
import assert from 'node:assert/strict';
import { GuardState } from '../src/core/guard.ts';
import { installGuard } from '../src/host/guard-runtime.ts';
import { apply } from '../src/plugin.ts';
function harness() {
  const listeners = new Map(), archived = [], reads = [];
  const agent = {session:{id:'synthetic-live',header:{cwd:'synthetic-workspace'}}};
  let command;
  const ctx = {on(name, fn){listeners.set(name,fn);}, workspaceRegistry:{archivedSessionIds:archived,list(){return [{path:'synthetic-workspace',sessionIds:['synthetic-live','synthetic-old','synthetic-archived']}];}},
    commands:{register(value){command=value;}},sessionQuery:{listSessions(){throw Error('Must not list entire corpus');},async readSession(id){reads.push(id);return {session:{id,version:4,cwd:'synthetic-workspace',createdAt:1},inheritedEventCount:0,events:[]};}}};
  const guard=installGuard(ctx);
  let counter=0;
  async function attempt({body='Synthetic failure',isError=true,code='SYNTHETIC_ERROR',args={command:'synthetic-check'},name='bash',parent}={}) {
    const exec={agent,callId:`synthetic-${++counter}`,arguments:args,name,parent,signal:new AbortController().signal};
    await listeners.get('tools/pre-execute')(exec,async()=>({kind:'allow'}));
    await listeners.get('tools/execute')(exec,async()=>undefined);
    listeners.get('tools/result')(exec,{content:[{type:'text',text:body}],isError,...(isError?{error:{info:{name:'SyntheticError',code}}}:{})});
    return exec;
  }
  const step=(turn=1,messages=[])=>listeners.get('agent/pre-step')({agent,turn,messages,signal:new AbortController().signal},async()=>({kind:'enter',messages,startsRequestSeries:true}));
  return {ctx,agent,guard,listeners,archived,reads,attempt,step,get command(){return command;}};
}
test('live modes default off; exact settled failures warn once, never execute or rewrite tools',async()=>{
  const h=harness(); await h.attempt();assert.equal((await h.step()).messages.length,0);
  h.guard.command(h.agent,['mode','warn']);await h.attempt();await h.attempt();
  const reply=await h.step();assert.equal(reply.startsRequestSeries,true);assert.equal(reply.messages[0].source.kind,'waymark');
  assert.match(reply.messages[0].content[0].text,/R1/);assert.ok(Object.isFrozen(reply.messages[0]));
  await h.attempt();assert.equal((await h.step(2)).messages.length,0);assert.equal(h.reads.length,0);
});
test('observe produces decisions without injecting; cancellation, edits, changed errors/args prevent failure loops',async()=>{
  for(const option of [{code:'ABORTED'}, {isError:false,name:'edit'}, {args:{command:'different'}}, {body:'different error'}]) {
    const h=harness();h.guard.command(h.agent,['mode','warn']);await h.attempt();await h.attempt(option);
    assert.equal((await h.step()).messages.length,0);
  }
  const h=harness();h.guard.command(h.agent,['mode','observe']);await h.attempt();await h.attempt();
  assert.equal((await h.step()).messages.length,0);assert.equal(JSON.parse(h.guard.command(h.agent,['status'])).observed.R1,1);
});
test('large output notice preserves original result; source is injected not human',async()=>{
  const h=harness();h.guard.command(h.agent,['mode','warn']);await h.attempt({body:'x'.repeat(16001),isError:false});
  assert.match((await h.step()).messages[0].content[0].text,/R3/);
  h.guard.command(h.agent,['feedback','1','helpful']);assert.equal(JSON.parse(h.guard.command(h.agent,['status'])).feedback['1'],'helpful');
});
test('concurrent, duplicate and late results do not become sequential retries; budgets apply',()=>{
  const s=new GuardState();s.setMode('warn');s.begin('a','k');s.begin('b','k');s.settle('a','failure','e',0);s.settle('b','failure','e',0);
  assert.equal(s.peek(1),undefined);s.begin('c','k');s.settle('c','failure','e',0);s.settle('c','failure','e',0);assert.equal(s.peek(1),undefined);
  s.reset();s.settle('missing','failure','e',0);assert.equal(s.peek(1),undefined);
  for(let i=0;i<10;i++){s.reset();s.begin(`n${i}`,'k');s.settle(`n${i}`,'success',undefined,5000);if(s.peek(i))s.delivered(i);}
  assert.equal(s.sent,5);
});
test('human input, archive, context replacement, disposal and rejected downstream clear or suppress notices',async()=>{
  for(const kind of ['human','archive','replacement','dispose','reject']){
    const h=harness();h.guard.command(h.agent,['mode','warn']);await h.attempt();await h.attempt();
    if(kind==='archive')h.archived.push(h.agent.session.id);
    if(kind==='replacement')h.listeners.get('session/event')(h.agent.session,{type:'synthetic',surfaceOp:{op:'replace'}});
    if(kind==='dispose')h.listeners.get('session/disposed')(h.agent.session);
    const messages=kind==='human'?[{source:{kind:'user'},content:[]}]:[];
    const result=kind==='reject'?await h.listeners.get('agent/pre-step')({agent:h.agent,messages:[],turn:1,signal:new AbortController().signal},async()=>({kind:'reject'})):await h.step(1,messages);
    assert.ok(result.kind==='reject'||result.messages.length===messages.length);
  }
});
test('product commands exclude archived ids before reads, including last; unavailable registry fails closed',async()=>{
  const h=harness();h.archived.push('synthetic-archived');apply(h.ctx);
  const invoke=rawInput=>h.command.handler({agent:h.agent,rawInput,signal:new AbortController().signal});
  assert.equal((await invoke('retro synthetic-archived')).kind,'error');assert.deepEqual(h.reads,[]);
  assert.equal((await invoke('retro last')).kind,'success');assert.ok(!h.reads.includes('synthetic-archived'));
  h.archived.push('synthetic-live');assert.equal((await invoke('retro')).kind,'error');
  delete h.ctx.workspaceRegistry;assert.equal((await invoke('retro synthetic-old')).kind,'error');
});
test('user-only delivery leaves model context intact and exposes evidence locally; injected inputs do not reset',async()=>{
  const h=harness();h.guard.command(h.agent,['delivery','user']);h.guard.command(h.agent,['mode','warn']);
  const first=await h.attempt();const second=await h.attempt();
  for(const [index,call] of [first,second].entries())h.listeners.get('session/event')(h.agent.session,{type:'tool/result',seq:index+10,data:{message:{toolCallId:call.callId}}});
  const messages=[{source:{kind:'synthetic-plugin'},content:[]}];assert.equal((await h.step(1,messages)).messages.length,1);
  const status=JSON.parse(h.guard.command(h.agent,['status']));assert.match(status.notices[0].text,/seq 10、seq 11/);assert.equal(status.sent,0);
});
test('incremental replay is deterministic, configurable, and bounded',()=>{
  const run=()=>{const s=new GuardState({failWarnMin:3});s.setMode('observe');for(let i=0;i<4;i++){s.begin(String(i),'k');s.settle(String(i),'failure','e',5);}return s.status();};
  assert.deepEqual(run(),run());assert.equal(run().observed.R1,1);
  for(const options of [{failWarnMin:1},{maxChars:20},{maxPerSession:Infinity},{unknown:1}])assert.throws(()=>new GuardState(options));
  const s=new GuardState();s.setMode('warn');for(let i=0;i<201;i++)s.begin(String(i),'k');assert.equal(s.mode,'off');
});
test('archive status changing during snapshot read suppresses any report',async()=>{
  const h=harness();apply(h.ctx);h.ctx.sessionQuery.readSession=async()=>{h.archived.push('synthetic-old');return {session:{id:'synthetic-old',version:4},events:[],inheritedEventCount:0};};
  const result=await h.command.handler({agent:h.agent,rawInput:'retro synthetic-old --json',signal:new AbortController().signal});
  assert.equal(result.kind,'error');assert.doesNotMatch(result.text,/schemaVersion/);
});
