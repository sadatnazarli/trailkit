import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/memory': 'src/adapters/memory.ts',
    'adapters/sqlite': 'src/adapters/sqlite.ts',
    'adapters/postgres': 'src/adapters/postgres.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  splitting: false,
  sourcemap: true,
});
