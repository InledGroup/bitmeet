let client: any = null;

export const getWebTorrentClient = async () => {
  if (typeof window === 'undefined') return null;
  if (!client) {
    try {
      // @ts-ignore
      const WebTorrent = (await import('webtorrent/dist/webtorrent.min.js')).default;
      // Usamos la configuración por defecto de WebTorrent para máxima compatibilidad
      client = new WebTorrent();
    } catch (e) {
      console.error("WebTorrent initialization failed:", e);
      throw e;
    }
  }
  return client;
};