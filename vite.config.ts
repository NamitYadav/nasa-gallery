/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/nasa-gallery/',
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'] },
});
