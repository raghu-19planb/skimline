import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const page = (name: string) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig({
  build: {
    rollupOptions: {
      input: { home: page('index'), plan: page('plan'), guide: page('guide'), planners: page('planners'), methods: page('methods') },
    },
  },
});
