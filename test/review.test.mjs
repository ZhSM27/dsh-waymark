import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeReview} from '../src/core/review.ts';
test('pending and uncertain decisions never become agreement',()=>{
  const rows=[null,'uncertain','agree','disagree','disagree'].map((decision,i)=>({id:`synthetic-${i}`,rule:'R1',decision}));
  const [r1,r2]=summarizeReview(rows);
  assert.equal(r1.agreementRatio,1/3);assert.equal(r1.pending,1);assert.equal(r1.uncertain,1);
  assert.equal(r1.needsRetest,true);assert.equal(r1.complete,false);assert.equal(r2.agreementRatio,null);
  assert.equal(summarizeReview([{id:'a',rule:'R3',decision:null}])[2].agreementRatio,null);
});
test('review rejects duplicate identities and fabricated decision values',()=>{
  assert.throws(()=>summarizeReview([{id:'a',rule:'R1',decision:'yes'}]));
  assert.throws(()=>summarizeReview([{id:'a',rule:'R1',decision:null},{id:'a',rule:'R2',decision:null}]));
});
