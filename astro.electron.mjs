import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Configuración específica para Electron (Rutas relativas estrictas)
export default defineConfig({
  output: 'static',
  base: '', // Ruta vacía para que Astro no añada '/' inicial
  integrations: [react()],
  build: {
    assets: '_astro'
  },
  vite: {
    base: './', // Vite sí necesita ./ para los assets internos
    build: {
      cssCodeSplit: false,
      assetsDir: '_astro',
    },
    optimizeDeps: {
      include: ['qrcode', 'html5-qrcode']
    }
  }
});
