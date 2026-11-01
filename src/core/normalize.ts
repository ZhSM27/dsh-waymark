import type { Config } from './types.ts';

/** Stable JSON only; reject cycles/non-JSON so malformed inputs never silently share a key. */
export function canonicalArgs(value: unknown, config?: Config): string {
  const ancestors = new Set<object>();
  function visit(current: unknown, depth: number): unknown {
    if (depth > 100) throw new RangeError('Argument nesting exceeds 100');
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current === 'string') {
      for (const prefix of config?.temporaryPathPrefixes ?? []) {
        // Retain the relative suffix: different temporary targets stay distinguishable.
        if (current.startsWith(prefix)) return `<temporary>/${current.slice(prefix.length)}`;
      }
      return current;
    }
    if (typeof current !== 'object' || current === null || ancestors.has(current)) throw new TypeError('Arguments must be acyclic JSON');
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
      throw new TypeError('Arguments must contain only JSON objects');
    }
    ancestors.add(current);
    const result = Array.isArray(current) ? current.map(item => visit(item, depth + 1))
      : Object.fromEntries(Object.keys(current).sort().filter(key => !config?.volatileArgumentKeys.includes(key))
        .map(key => [key, visit((current as Record<string, unknown>)[key], depth + 1)]));
    ancestors.delete(current);
    return result;
  }
  return JSON.stringify(visit(value, 0));
}

/** Linear-time multiset bigram Dice similarity, with a numeric-argument safety check. */
export function argumentSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if ((a.match(/\d+/g) ?? []).join('|') !== (b.match(/\d+/g) ?? []).join('|')) return 0;
  const left = Array.from(a), right = Array.from(b);
  if (left.length < 2 || right.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 1; i < left.length; i++) {
    const gram = `${left[i - 1]}${left[i]}`;
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 1; i < right.length; i++) {
    const gram = `${right[i - 1]}${right[i]}`, count = grams.get(gram) ?? 0;
    if (count > 0) { shared++; grams.set(gram, count - 1); }
  }
  return 2 * shared / (left.length + right.length - 2);
}
