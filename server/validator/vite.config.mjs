import { resolve } from 'node:path';

export default {
  // The bundle is the whole output. Without this, the browser application's own
  // `public/` tree is Vite's default and is copied in beside it, because this
  // config is run from the repository root.
  publicDir: false,
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
