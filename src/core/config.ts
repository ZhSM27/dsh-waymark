import type { Config } from './types.ts';

export const DEFAULT_CONFIG: Config = Object.freeze({
  failLoopMin: 3,
  similarityThreshold: 0.8,
  bigOutputTokens: 4000,
  topN: 5,
  volatileArgumentKeys: Object.freeze([]),
  temporaryPathPrefixes: Object.freeze([]),
});

export function resolveConfig(overrides: Partial<Config> = {}): Config {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  for (const [key, minimum] of [['failLoopMin', 2], ['topN', 1]] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < minimum) throw new RangeError(`Invalid ${key}`);
  }
  if (!Number.isFinite(config.bigOutputTokens) || config.bigOutputTokens < 0) throw new RangeError('Invalid bigOutputTokens');
  if (!Number.isFinite(config.similarityThreshold) || config.similarityThreshold <= 0 || config.similarityThreshold > 1) {
    throw new RangeError('Invalid similarityThreshold');
  }
  for (const key of ['volatileArgumentKeys', 'temporaryPathPrefixes'] as const) {
    if (!Array.isArray(config[key]) || config[key].some(value => typeof value !== 'string' || value.length === 0)) {
      throw new TypeError(`Invalid ${key}`);
    }
  }
  return { ...config, volatileArgumentKeys: [...config.volatileArgumentKeys], temporaryPathPrefixes: [...config.temporaryPathPrefixes] };
}
