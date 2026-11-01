import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkspacePolicy,allowHeader,encodeSessionSegment,assertPrivateResearchRoot} from '../scripts/archive-policy.mjs';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function metadata(){return{unit:{name:'workspace',version:2},global:{initialized:true,workspaceIds:['synthetic-workspace'],archivedSessionIds:['archived-example']},tables:{workspaces:{'synthetic-workspace':{sessionIds:['active-example','archived-example']}}}};}
test('archive set takes priority over workspace membership',()=>{
  const policy=parseWorkspacePolicy(metadata());
  assert.deepEqual([...policy.allowed],['active-example']);assert.ok(policy.archived.has('archived-example'));
});
test('unknown, missing, changing and inconsistent archive metadata fail closed',()=>{
  for(const edit of [d=>delete d.global.archivedSessionIds,d=>d.global.initialized=false,d=>d.global.pendingMutation={},d=>d.unit.version=99,d=>d.global.workspaceIds.push('synthetic-workspace'),d=>d.tables.workspaces.extra={sessionIds:[]}]){
    const d=metadata();edit(d);assert.throws(()=>parseWorkspacePolicy(d));
  }
});
test('archived, seeded, related, historical and unknown headers cannot be approved',()=>{
  const allowed=parseWorkspacePolicy(metadata()).allowed;
  const header={id:'active-example',version:4,isSeeded:false};
  assert.ok(allowHeader(header,4,allowed));
  for(const extra of [{id:'archived-example'},{isSeeded:true},{isSeeded:undefined},{parentSession:'archived-example'},{origin:'subagent'},{delegationDepth:1}])assert.equal(allowHeader({...header,...extra},4,allowed),false);
  assert.equal(allowHeader(header,3,allowed),false);
});
test('directory identity escaping matches the verified dsh encoding',()=>{
  assert.equal(encodeSessionSegment('synthetic-a'),'synthetic-a');
  assert.equal(encodeSessionSegment('a/b~'),'a~002Fb~007E');assert.equal(encodeSessionSegment('..'),'~002E~002E');
});
test('archive-unaware readers reject user roots before processing data',async()=>{
  const base=await mkdtemp(join(tmpdir(),'waymark-synthetic-policy-'));
  try{
    const privateRoot=join(base,'research'),allowed=join(privateRoot,'isolated'),forbidden=join(base,'user-data');
    await mkdir(allowed,{recursive:true});await mkdir(forbidden);
    await assertPrivateResearchRoot(allowed,privateRoot);
    await assert.rejects(assertPrivateResearchRoot(forbidden,privateRoot),/Archive-unaware/);
  }finally{await rm(base,{recursive:true,force:true});}
});
