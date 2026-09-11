import { resolve } from 'node:path';

export default {
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'commander-validator.ts'),
      formats: ['es'],
      fileName: () => 'commander-validator.mjs',
    },
    minify: false,
    outDir: resolve(import.meta.dirname, 'dist'),
    rollupOptions: {
      external: [/^node:/u],
    },
    target: 'node24',
  },
};
