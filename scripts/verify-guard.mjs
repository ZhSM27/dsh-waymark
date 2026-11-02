// Synthetic only: real Cordis/tool pipeline, no persistence, user home, model or network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { researchModule } from './dsh-runtime.mjs';
import { installGuard } from '../src/host/guard-runtime.ts';
const require = createRequire(await realpath('.research/node_modules/@deepseek-ai/dsh/package.json'));
const {Context} = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const {ToolRuntime} = await researchModule('@deepseek-ai/dsh-tools');
const reminder = await researchModule('@deepseek-ai/dsh-repeat-tool-reminder');
const ctx = new Context();
const promptFiber=ctx.plugin((await researchModule('@deepseek-ai/dsh-system-prompt')).default);await promptFiber.await();
ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[{path:'synthetic',sessionIds:['synthetic-guard']}]});
const toolsFiber=ctx.plugin(ToolRuntime);await toolsFiber.await();
const agent={session:{id:'synthetic-guard',header:{}}};
let guard, bodies=0;
const plugin=ctx.plugin({name:'synthetic-waymark-live',apply(inner){guard=installGuard(inner);}});await plugin.await();
const reminderFiber=ctx.plugin(reminder,{thresholds:[3,5,8],include:[],exclude:[],argumentsPreviewChars:500});await reminderFiber.await();
const unregister=ctx.tools.register({name:'synthetic-check',description:'Synthetic check',parameters:{type:'object',properties:{}},output:{schema:{type:'null'},render:()=>[]},async execute(){bodies++;throw new Error('Synthetic check failure');}});
try {
  guard.command(agent,['mode','warn']);
  const signal=new AbortController().signal;
  for(let i=0;i<3;i++){
    const result=await ctx.tools.execute({callId:`synthetic-${i}`,name:'synthetic-check',arguments:{},agent,signal});
    assert.equal(result.isError,true);
    if(i===2)assert.equal(result.additionalContexts[0].source.kind,'repeat-tool-reminder');
  }
  const step=await ctx.waterfall('agent/pre-step',{agent,turn:1,step:1,messages:[],signal},async()=>({kind:'enter',messages:[]}));
  assert.equal(step.messages.length,1);assert.equal(step.messages[0].source.kind,'waymark');assert.match(step.messages[0].content[0].text,/R1/);
  assert.equal(bodies,3);
  // Native monotonic denials never reach tools/execute; they must not fabricate R1 failures.
  guard.command(agent,['mode','warn']);const deny=ctx.tools.guard(()=> 'Synthetic host denial');
  for(let i=3;i<6;i++)await ctx.tools.execute({callId:`synthetic-${i}`,name:'synthetic-check',arguments:{},agent,signal});
  assert.equal(JSON.parse(guard.command(agent,['status'])).observed.R1,1); // lifetime total, no additional failure episode
  deny();
  await plugin.dispose();
  const unloaded=await ctx.waterfall('agent/pre-step',{agent,turn:2,messages:[],signal},async()=>({kind:'enter',messages:[]}));
  assert.equal(unloaded.messages.length,0);
  console.log(JSON.stringify({syntheticOnly:true,nativeTools:true,nativePreStep:true,officialReminderCoexists:true,denialsNotFailures:true,unload:true,toolBodies:bodies}));
} finally {unregister();await reminderFiber.dispose();await plugin.dispose();await toolsFiber.dispose();await promptFiber.dispose();}
