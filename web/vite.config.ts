import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        map: resolve(import.meta.dirname, 'map.html'),
        methods: resolve(import.meta.dirname, 'methods.html'),
        guide: resolve(import.meta.dirname, 'guide.html'),
        planners: resolve(import.meta.dirname, 'planners.html'),
      },
    },
  },
});
