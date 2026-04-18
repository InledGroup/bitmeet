import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Configuración estándar para desarrollo y web (Cloudflare)
export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: {
    optimizeDeps: {
      include: ['qrcode', 'html5-qrcode']
    }
  },
  server: {
    port: 4323,
  },
});
