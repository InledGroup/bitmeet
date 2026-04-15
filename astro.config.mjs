
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
// BitMeet es una app 100% client-side (P2P, IndexedDB, WebRTC).
// No hay datos que procesar en el servidor, por lo que 'static' es el
// modo correcto. Cloudflare Pages servirá el directorio dist/ directamente.
export default defineConfig({
  output: 'static',
  integrations: [react()],
});
