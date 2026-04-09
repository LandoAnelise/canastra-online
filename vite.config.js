import { defineConfig } from 'vite';

// Bundle the frontend JS and CSS assets with content-based hashes.
// The server reads dist/.vite/manifest.json at runtime to inject the correct
// hashed file paths into index.html.  When no build is present (dev mode via
// nodemon) the server falls back to the existing ?v=HASH query-string approach.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    // Generate dist/.vite/manifest.json so the Express server can map
    // original paths (e.g. /css/base.css) to their hashed equivalents.
    manifest: true,
    rollupOptions: {
      input: {
        main: 'public/js/main.js',
        base: 'public/css/base.css',
        lobby: 'public/css/lobby.css',
        game: 'public/css/game.css',
        modals: 'public/css/modals.css',
        utils: 'public/css/utils.css',
      },
    },
  },
});
