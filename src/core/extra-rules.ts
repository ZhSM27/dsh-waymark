import type { Config, CorrectionFinding, Event, Evidence, RereadFinding, ToolCall, ToolResult } from './types.ts';
import { eventSize, sumSizes } from './tokens.ts';

function evidence(event: ToolCall | ToolResult | Extract<Event, {kind:'user'}>): Evidence {
  return { kind:event.kind,seq:event.seq,turn:event.turn,...(event.step!==undefined?{step:event.step}:{}),
    ...(event.kind==='tool_call'?{callId:event.id}:event.kind==='tool_result'?{callId:event.callId}:{}) };
}

export function detectRereads(events: readonly Event[], calls: ReadonlyMap<string,ToolCall>, config: Config): RereadFinding[] {
  const findings: RereadFinding[] = [];
  const groups = new Map<string, Map<string, {call:ToolCall;result:ToolResult}[]>>();
  const resets = new Map<string,number>();
  let boundarySeq=-1;
  function flush(path:string) {
    for(const group of groups.get(path)?.values()??[]) {
      if(group.length<config.rereadMin) continue;
      const first=group[0]!, file=first.result.file!;
      findings.push({id:`R2:${first.result.seq}`,rule:'R2',confidence:file.fingerprint&&file.range?'high':'medium',
        path,reads:group.length,range:file.range??null,sameContentVerified:!!file.fingerprint,
        evidence:group.flatMap(item=>[evidence(item.call),evidence(item.result)]),
        repeatedCallIds:group.slice(1).map(item=>item.call.id),
        repeatedContent:sumSizes(group.slice(1).flatMap(item=>[eventSize(item.call),eventSize(item.result)])),
        suggestion:'同一文件片段没有已观察到的成功修改时，优先复用已有读取结果；只为新的诊断目标读取新的范围。',
        limitations:['仅检查已支持工具的读写记录，外部编辑和未支持的 shell 写入不可观测。',
          ...(file.fingerprint?[]:['缺少返回内容指纹，无法确认各次内容完全相同。']),
          ...(file.range?[]:['缺少可靠读取范围，需人工复核。'])]});
    }
    groups.delete(path);
  }
  for(const event of events) {
    if(event.kind==='boundary'||event.barrier) {
      for(const path of groups.keys()) flush(path);
      boundarySeq=event.seq;
    }
    if(event.kind!=='tool_result'||!event.file||event.outcome!=='success') continue;
    const file=event.file, call=calls.get(event.callId);
    if(file.operation!=='read') {flush(file.path);resets.set(file.path,event.seq);continue;}
    if(!call||call.seq<=Math.max(resets.get(file.path)??-1,boundarySeq)) continue;
    const key=JSON.stringify([file.range??null,file.fingerprint??null]);
    let pathGroups=groups.get(file.path);
    if(!pathGroups) {pathGroups=new Map();groups.set(file.path,pathGroups);}
    const group=pathGroups.get(key)??[];
    group.push({call,result:event});pathGroups.set(key,group);
  }
  for(const path of groups.keys()) flush(path);
  return findings;
}

function keywordMatch(text:string,keyword:string):boolean {
  if(!/^[\x00-\x7f]+$/.test(keyword)) return text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
  const escaped=keyword.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,'iu').test(text);
}

export function detectCorrections(events:readonly Event[],config:Config):CorrectionFinding[] {
  const findings:CorrectionFinding[]=[];
  let lastTool:ToolCall|ToolResult|undefined;
  for(const event of events) {
    if(event.kind==='tool_call'||event.kind==='tool_result') lastTool=event;
    else if(event.kind==='boundary'&&event.reason!=='interruption') lastTool=undefined;
    else if(event.kind==='user'&&event.source!=='injected') {
      const keyword=event.source==='human'&&lastTool?config.correctionKeywords.find(word=>keywordMatch(event.text,word)):undefined;
      if(keyword&&lastTool) findings.push({id:`R4:${event.seq}`,rule:'R4',confidence:'low',keyword,
        excerpt:Array.from(event.text).slice(0,80).join(''),evidence:[evidence(lastTool),evidence(event)],
        suggestion:'用户纠偏后先复述新的约束或目标，再调整下一步；不要继续沿用已被否定的操作。',
        limitations:['关键词可能表示正常任务变更或引文，不能据此断言模型犯错；不计入可避免 token。']});
      lastTool=undefined;
    }
  }
  return findings;
}
