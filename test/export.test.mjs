import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportMarkdown} from '../src/host/export.ts';
import {apply} from '../src/plugin.ts';

test('explicit export creates only a workspace report and refuses overwrite/traversal',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'waymark-synthetic-'));
  try {
    const signal=new AbortController().signal;
    const target=await exportMarkdown(workspace,'example.md','Synthetic report',signal);
    assert.equal(await readFile(target,'utf8'),'Synthetic report');
    await assert.rejects(exportMarkdown(workspace,'example.md','Replacement',signal));
    assert.equal(await readFile(target,'utf8'),'Synthetic report');
    for(const filename of ['../AGENTS.md','AGENTS.md','example.json']) await assert.rejects(exportMarkdown(workspace,filename,'Example',signal));
    const controller=new AbortController();controller.abort();
    await assert.rejects(exportMarkdown(workspace,'cancelled.md','Example',controller.signal));
  } finally {await rm(workspace,{recursive:true,force:true});}
});
test('exports refuse directory links',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'waymark-synthetic-'));
  const outside=await mkdtemp(join(tmpdir(),'waymark-synthetic-outside-'));
  try {
    await mkdir(join(outside,'reports'));
    await symlink(outside,join(workspace,'.waymark'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(exportMarkdown(workspace,'example.md','Example',new AbortController().signal),/Linked/);
  }finally{await rm(workspace,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('native command export mode writes Markdown, then reports an existing target clearly',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'waymark-synthetic-command-'));
  try {
    let definition;
    apply({commands:{register(value){definition=value;return()=>{};}},sessionQuery:{async listSessions(){return[];},
      async readSession(){return{session:{id:'synthetic',version:4},inheritedEventCount:0,events:[]};}}});
    const invocation={agent:{session:{id:'synthetic',header:{cwd}}},signal:new AbortController().signal,rawInput:'retro --export example.md'};
    assert.equal((await definition.handler(invocation)).kind,'success');
    assert.match(await readFile(join(cwd,'.waymark/reports/example.md'),'utf8'),/# Waymark/);
    assert.match((await definition.handler(invocation)).text,/already exists/);
  }finally{await rm(cwd,{recursive:true,force:true});}
});
