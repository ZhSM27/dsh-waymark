import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSession} from '../src/core/index.ts';
import {builder} from './fixtures/sessions.mjs';
import {adaptDshSession} from '../src/adapters/dsh.ts';

test('audit counts outcomes and verification observations without claiming task completion',()=>{
  const b=builder();b.attempt(undefined,{verification:'test'},{outcome:'success'});
  b.attempt(undefined,undefined,{outcome:'unknown'});b.call();
  const {audit}=analyzeSession(b.session());
  assert.equal(audit.toolCalls,3);assert.equal(audit.outcomes.success,1);assert.equal(audit.outcomes.unknown,1);assert.equal(audit.outcomes.unresolved,1);
  assert.equal(audit.verification[0].kind,'test');assert.equal(audit.verification[0].outcome,'success');
});
test('verification recognition excludes echo and compound commands',()=>{
  for(const [command,expected]of [['pnpm test',1],['npm run typecheck',1],['echo npm test',0],['npm test; echo ok',0],['pnpm testing',0]]) {
    const raw={session:{id:'synthetic',version:4},inheritedEventCount:0,events:[{seq:0,type:'tool/call',data:{turn:1,step:1,callId:'a',name:'bash',arguments:JSON.stringify({command})}}]};
    assert.equal(analyzeSession(adaptDshSession(raw).input).audit.verification.length,expected);
  }
});
test('proposal text is deduplicated while all supporting finding ids are retained',()=>{
  const b=builder();for(let i=0;i<4;i++)b.attempt(undefined,undefined,{outcome:'success',tokens:5000});
  const report=analyzeSession(b.session());
  assert.equal(report.findings.length,4);assert.equal(report.proposals.length,1);
  assert.equal(report.proposals[0].sourceFindingIds.length,4);assert.equal(report.proposals[0].scope,'project-candidate');
});
