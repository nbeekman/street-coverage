// `vitest/config` re-exports Vite's defineConfig with the `test` key typed.
// Importing from 'vite' instead makes `test` a type error.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // maplibre-gl alone minifies to ~1 MB and cannot be split -- it is one
    // library and the map needs all of it. The default 500 kB warning can only
    // ever fire here, so it is raised to a level that would mean something.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Split by change frequency, not by size. deck.gl and React move on
        // their own release cycles, so keeping them out of the app chunk means
        // editing a component does not invalidate 600 kB of vendor code in
        // returning visitors' caches.
        //
        // This does not speed up a cold load: every chunk is needed to render.
        // The real first-load cost here is the ~21 MB of binary snapshots, not
        // the JavaScript.
        manualChunks: (id: string) => {
          if (id.includes('/node_modules/@deck.gl/')) return 'deck'
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
