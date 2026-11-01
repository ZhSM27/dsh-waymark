import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSession,renderReport,renderMarkdown } from '../src/core/index.ts';
import { builder } from './fixtures/sessions.mjs';

function read(b,{path='sample.txt',range='1:10',fingerprint='synthetic-content',outcome='success',tokens=10}={}) {
  return b.attempt({file:path},{tool:'read',tokens:2},{outcome,tokens,text:'Synthetic read',file:{operation:'read',path,range,fingerprint}});
}
function write(b,outcome='success',path='sample.txt') {
  return b.attempt({file:path},{tool:'edit'},{outcome,text:'Synthetic edit',file:{operation:'edit',path}});
}
const rereads=report=>report.findings.filter(f=>f.rule==='R2');
const corrections=report=>report.findings.filter(f=>f.rule==='R4');

test('R2 flags unchanged range/content and excludes first read from repeated volume',()=>{
  const b=builder();for(let i=0;i<3;i++)read(b);
  const report=analyzeSession(b.session());
  assert.equal(rereads(report).length,1);
  assert.equal(rereads(report)[0].reads,3);
  assert.equal(rereads(report)[0].repeatedContent.value,24);
  assert.equal(report.suspectedAvoidableContent.value,24);
  assert.deepEqual(rereads(report)[0].evidence.map(e=>e.seq),[0,1,2,3,4,5]);
});
test('R2 respects successful writes; failed or unrelated edits do not reset',()=>{
  for(const [outcome,path,expected]of [['success','sample.txt',0],['failure','sample.txt',1],['success','other.txt',1]]) {
    const b=builder();read(b);read(b);write(b,outcome,path);read(b);
    assert.equal(rereads(analyzeSession(b.session())).length,expected);
  }
});
test('R2 separates new ranges/content and explicit history boundaries',()=>{
  const b=builder();read(b);read(b,{range:'11:20'});read(b,{fingerprint:'changed'});
  assert.equal(rereads(analyzeSession(b.session())).length,0);
  const c=builder();read(c);read(c);c.add({kind:'boundary',reason:'history-cut'});read(c);
  assert.equal(rereads(analyzeSession(c.session())).length,0);
});
test('in-flight reads spanning a successful edit are not assigned the new file version',()=>{
  const b=builder();const pending=b.call({file:'sample.txt'},{tool:'read'});write(b);
  b.result(pending,{outcome:'success',file:{operation:'read',path:'sample.txt',range:'1:10',fingerprint:'synthetic-content'}});
  read(b);read(b);
  assert.equal(rereads(analyzeSession(b.session())).length,0);
});
test('R2 can be configured and missing fingerprints reduce confidence',()=>{
  const b=builder();for(let i=0;i<3;i++) {
    const pair=read(b); delete pair.result.file.fingerprint;
  }
  assert.equal(rereads(analyzeSession(b.session()))[0].confidence,'medium');
  assert.equal(rereads(analyzeSession(b.session(),{rereadMin:4})).length,0);
});
test('R4 requires a real user after tool activity and is low confidence without waste',()=>{
  const b=builder();b.attempt(undefined,undefined,{outcome:'success'});
  b.add({kind:'assistant',text:'Synthetic response'});
  b.add({kind:'user',source:'human',text:'不对，请重来'});
  const report=analyzeSession(b.session());
  assert.equal(corrections(report).length,1);
  assert.equal(corrections(report)[0].confidence,'low');
  assert.equal(report.suspectedAvoidableContent.value,0);
  assert.match(renderReport(report),/低/);
  for(const source of ['injected','unknown']) {
    const c=builder();c.attempt();c.add({kind:'user',source,text:'stop'});
    assert.equal(corrections(analyzeSession(c.session())).length,0);
  }
  const d=builder();d.add({kind:'user',source:'human',text:'stop'});
  assert.equal(corrections(analyzeSession(d.session())).length,0);
});
test('English keyword boundaries avoid substrings; dictionaries and 80-character snippets are configurable',()=>{
  for(const [text,expected]of [['unstoppable',0],['stopping',0],['STOP, please',1]]) {
    const b=builder();b.attempt();b.add({kind:'user',source:'human',text});
    assert.equal(corrections(analyzeSession(b.session())).length,expected);
  }
  const b=builder();b.attempt();b.add({kind:'user',source:'human',text:'redo '+ '😀'.repeat(100)});
  const report=analyzeSession(b.session(),{correctionKeywords:['redo']});
  assert.equal(Array.from(corrections(report)[0].excerpt).length,80);
  assert.equal(corrections(analyzeSession(b.session())).length,0);
});
test('unknown config keys are rejected; empty correction dictionary disables R4',()=>{
  const b=builder();b.attempt();b.add({kind:'user',source:'human',text:'stop'});
  assert.equal(corrections(analyzeSession(b.session(),{correctionKeywords:[]})).length,0);
  assert.throws(()=>analyzeSession(b.session(),{rereadMin:1}));
  assert.throws(()=>analyzeSession(b.session(),{misspelledThreshold:1}),/Unknown/);
});
test('Markdown fences contain untrusted backticks and HTML as report text',()=>{
  const b=builder();for(let i=0;i<3;i++) read(b,{path:'```<script>example</script>'});
  const md=renderMarkdown(analyzeSession(b.session()));
  assert.match(md,/````text/);
  assert.ok(md.endsWith('````\n'));
});
