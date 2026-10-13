import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: la misma build funciona en https://<usuario>.github.io/<repo>/,
// en un dominio propio o abriendo dist/ con `npm run preview`.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'app', sourcemap: false },
});
