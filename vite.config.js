import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

// The Thymio 3 API is not vendored: package.json depends on github:Mobsya/thymio3-ts-api#main and
// we alias its TypeScript entry point, so every build compiles current upstream source (the same
// arrangement as thymio3-cockpit). Take upstream changes with:  npm run api:update && npm run build
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      'thymio-api': resolve(here, 'node_modules/thymio3-ts-api/src/thymio.ts'),
    },
  },
});
