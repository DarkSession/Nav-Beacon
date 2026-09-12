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
    // One file, whatever the browser's own modules do about code splitting. The
    // reconstructor is reached through a loader so that a browser fetches the
    // outfitting catalogue only when it needs it; a validator process has no
    // first frame to protect, and the server starts it by the path of this one
    // script.
    rollupOptions: {
      external: [/^node:/u],
      output: { codeSplitting: false },
    },
    target: 'node24',
  },
};
