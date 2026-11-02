import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptDshSession } from '../src/adapters/dsh.ts';
import { analyzeSession } from '../src/core/index.ts';
import { apply } from '../src/plugin.ts';

function snapshot(records) {
  return { session:{id:'synthetic-dsh',version:4,cwd:'synthetic-workspace'},inheritedEventCount:0,
    events:records.map((event,seq)=>({seq,time:seq,...event})) };
}
function rawCall(callId, name='bash', args={command:'example-check'}) {
  return {type:'tool/call',data:{turn:1,step:1,callId,name,arguments:JSON.stringify(args)}};
}
function rawResult(callId, body='Example\n[exit code: 2]', extra={}) {
  return {type:'tool/result',surfaceOp:'append',data:{turn:1,step:1,message:{toolCallId:callId,content:[{type:'text',text:body}],...extra}}};
}

test('adapter pairs canonical calls, extracts text and does not duplicate embedded calls',()=>{
  const raw=snapshot([{type:'turn/start',data:{turn:1}},{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'Example'}]}},
    {type:'assistant/message',data:{turn:1,step:1,message:{content:[{type:'tool-call',id:'a',name:'bash',arguments:'{}'}]},stream:[]}},rawCall('a'),rawResult('a')]);
  const {input}=adaptDshSession(raw);
  assert.equal(input.events.filter(e=>e.kind==='tool_call').length,1);
  assert.equal(input.events.find(e=>e.kind==='user').source,'human');
  assert.equal(input.events.at(-1).outcome,'failure');
  assert.equal(input.events.at(-1).outcomeSource,'text-marker');
});
test('shell markers apply only to known shell tools and pwsh exit 1 stays unknown',()=>{
  for(const [tool,expected] of [['bash','failure'],['pwsh','unknown'],['read','success']]) {
    const {input}=adaptDshSession(snapshot([rawCall('a',tool),rawResult('a','[exit code: 1]')]));
    assert.equal(input.events.at(-1).outcome,expected);
  }
});
test('background, timeout and infrastructure cancellation are not ordinary failures',()=>{
  for(const body of ['started background job synthetic-job','[timed out after 10ms]','[stopped: example]']) {
    assert.equal(adaptDshSession(snapshot([rawCall('a'),rawResult('a',body)])).input.events.at(-1).outcome,'unknown');
  }
  const raw=snapshot([rawCall('a'),rawResult('a','Stopped',{isError:true})]);
  raw.events[1].data.error={name:'AbortError',code:'CANCELLED'};
  assert.equal(adaptDshSession(raw).input.events.at(-1).outcome,'interrupted');
});
test('invalid usage is unavailable and original payload is not changed',()=>{
  const raw=snapshot([{type:'assistant/message',data:{turn:1,step:1,message:{content:[]},usage:{inputTokens:1,outputTokens:2,totalTokens:100}}}]);
  const before=structuredClone(raw), adapted=adaptDshSession(raw);
  assert.equal(adapted.input.events[0].requestUsage,undefined);
  assert.match(adapted.issues.join(),/usage/);
  assert.deepEqual(raw,before);
});
test('malformed arguments and interrupted attempts do not fabricate loops',()=>{
  const events=[];
  for(let i=0;i<3;i++) {const call=rawCall(String(i));call.data.arguments='invalid'; events.push(call,rawResult(String(i)));}
  assert.equal(analyzeSession(adaptDshSession(snapshot(events)).input).findings.length,0);
  assert.throws(()=>adaptDshSession({...snapshot([]),session:{id:'synthetic',version:99}}),/format/);
});

test('command defaults to current session, last is scoped, and cancellation/errors are sanitized',async()=>{
  let definition, selected;
  const snap=snapshot([]);
  const ctx={workspaceRegistry:{archivedSessionIds:[],list(){return [{path:'synthetic-workspace',sessionIds:['synthetic-current','synthetic-earlier','synthetic-other']}];}},commands:{register(value){definition=value;return()=>{};}},sessionQuery:{
    async listSessions(){return [
      {persisted:true,header:{id:'synthetic-other',cwd:'other',createdAt:3}},
      {persisted:true,header:{id:'synthetic-earlier',cwd:'synthetic-workspace',createdAt:1}},
      {persisted:true,header:{id:'synthetic-current',cwd:'synthetic-workspace',createdAt:2}},
    ];},async readSession(id){selected=id;return {...snap,session:{...snap.session,id,cwd:id==='synthetic-other'?'other':'synthetic-workspace',createdAt:id==='synthetic-earlier'?1:2}};}}};
  apply(ctx);
  const invocation={agent:{session:{id:'synthetic-current',header:{cwd:'synthetic-workspace'}}},rawInput:'retro',signal:new AbortController().signal};
  assert.equal((await definition.handler(invocation)).kind,'success');assert.equal(selected,'synthetic-current');
  await definition.handler({...invocation,rawInput:'retro last'});assert.equal(selected,'synthetic-earlier');
  const json=await definition.handler({...invocation,rawInput:'retro --json'});assert.equal(JSON.parse(json.text).schemaVersion,'0.1');
  assert.match((await definition.handler({...invocation,rawInput:'retro --markdown'})).text,/# Waymark/);
  assert.equal((await definition.handler({...invocation,rawInput:'retro --json --markdown'})).kind,'error');
  assert.equal((await definition.handler({...invocation,rawInput:'other'})).kind,'error');
  const controller=new AbortController();controller.abort();
  assert.match((await definition.handler({...invocation,signal:controller.signal})).text,/cancelled/);
  ctx.sessionQuery.readSession=async()=>{throw new Error('PRIVATE PAYLOAD');};
  const result=await definition.handler(invocation);assert.equal(result.kind,'error');assert.doesNotMatch(result.text,/PRIVATE/);
});

test('file semantics use canonical result metadata and verified read range/content',()=>{
  const raw=snapshot([rawCall('a','read',{file_path:'sample.txt'}),rawResult('a','Synthetic content')]);
  raw.session.cwd='/synthetic-workspace';
  raw.events[1].data.meta={path:'/synthetic-workspace/sample.txt',offset:1,lines:[{number:1,text:'Example'}]};
  const file=adaptDshSession(raw).input.events.at(-1).file;
  assert.equal(file.operation,'read');assert.equal(file.range,'1:1');assert.equal(file.fingerprint.length,64);
});
