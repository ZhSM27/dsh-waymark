import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/core/index.ts'],
  outDir: 'lib/core',
  format: 'esm',
  platform: 'neutral',
  target: 'es2024',
  dts: true,
  clean: true,
});
