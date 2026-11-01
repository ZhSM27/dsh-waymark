import type { Event, RequestUsage, TokenSize } from './types.ts';

export function assertTokenCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Token counts must be non-negative safe integers');
}

export function estimateText(text: string): TokenSize {
  let characters = 0;
  for (const _character of text) characters++;
  return { value: characters / 4, method: 'estimated' };
}

export function eventSize(event: Event): TokenSize {
  if (event.kind === 'boundary') return { value: 0, method: 'reported' };
  if (event.tokens !== undefined) {
    assertTokenCount(event.tokens);
    return { value: event.tokens, method: 'reported' };
  }
  if (event.kind === 'tool_call') {
    return estimateText(`${event.tool}\n${event.argsText ?? JSON.stringify(event.args)}`);
  }
  if (event.text === undefined) return { value: null, method: 'unavailable' };
  return estimateText(event.text);
}

export function sumSizes(sizes: readonly TokenSize[]): TokenSize {
  if (sizes.some(size => size.value === null)) return { value: null, method: 'unavailable' };
  const active = sizes.filter(size => size.value !== 0);
  const methods = new Set(active.map(size => size.method));
  const value = sizes.reduce((sum, size) => sum + (size.value ?? 0), 0);
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) throw new RangeError('Content total exceeds safe numeric range');
  return {
    value,
    method: methods.size > 1 ? 'mixed' : (active[0]?.method ?? 'reported'),
  };
}

export function usageSize(usage: RequestUsage): TokenSize {
  for (const value of Object.values(usage)) assertTokenCount(value);
  // inputTokens excludes caches; reasoningTokens is already part of outputTokens.
  const buckets = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  assertTokenCount(buckets);
  if (usage.reasoningTokens !== undefined && usage.reasoningTokens > usage.outputTokens) throw new RangeError('Reasoning tokens exceed output tokens');
  if (usage.totalTokens !== undefined && usage.totalTokens !== buckets) throw new RangeError('Request total disagrees with disjoint usage buckets');
  return { value: usage.totalTokens ?? buckets, method: 'reported' };
}

export function ratio(part: TokenSize, total: TokenSize): number | null {
  return part.value !== null && total.value !== null && total.value > 0 ? part.value / total.value : null;
}
