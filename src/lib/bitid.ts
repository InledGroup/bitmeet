import { WebCryptoProvider } from "../infrastructure/adapters/WebCryptoProvider";
import { IndexedDBIdentityStorage } from "../infrastructure/adapters/IndexedDBIdentityStorage";

export interface BitID {
  username: string;
  publicKey: string;
  privateKey?: CryptoKey;
}

export class BitIDService {
  private storage = new IndexedDBIdentityStorage();
  private crypto = new WebCryptoProvider();
  private apiUrl = "https://bitid-api.inled.es";

  // ─── Caché en Local Storage / Memoria ───────────────────────────────────────
  // TTL de 24 horas para colegas (contactos), persistente en localStorage.
  // TTL de 2 minutos para búsquedas (en memoria)
  private readonly COLLEAGUES_TTL = 24 * 60 * 60 * 1000; // 24 horas
  private searchCache = new Map<string, { data: any[]; ts: number }>();
  private readonly SEARCH_TTL = 2 * 60 * 1000; // 2 min
  private deviceId: string | null = null;
  // ───────────────────────────────────────────────────────────────────────────

  getDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    let id = localStorage.getItem("bitmeet_device_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("bitmeet_device_id", id);
    }
    this.deviceId = id;
    return id;
  }

  async importIdentity(data: any): Promise<void> {
    const identity = data.identity || data.metadata;
    const encrypted = data.encryptedPrivateKey;

    if (!identity || !encrypted) {
      throw new Error("Invalid identity format");
    }

    const encryptedKey = {
      encryptedData: Array.isArray(encrypted.encryptedData)
        ? new Uint8Array(encrypted.encryptedData).buffer
        : encrypted.encryptedData,
      salt: Array.isArray(encrypted.salt)
        ? new Uint8Array(encrypted.salt)
        : encrypted.salt,
      iv: Array.isArray(encrypted.iv)
        ? new Uint8Array(encrypted.iv)
        : encrypted.iv,
    };

    await this.storage.saveIdentity(identity, encryptedKey);
    // Invalidar caché al cambiar de identidad
    localStorage.removeItem("bitid_colleagues_cache");
    this.searchCache.clear();
  }

  async getIdentity(): Promise<BitID | null> {
    const identity = await this.storage.getIdentity();
    if (!identity) return null;
    return {
      username: identity.username,
      publicKey: identity.publicKey,
    };
  }

  async unlock(password: string): Promise<CryptoKey | null> {
    const encrypted = await this.storage.getEncryptedKey();
    if (!encrypted) return null;
    try {
      const key = await this.crypto.decryptPrivateKey(
        encrypted.encryptedData,
        password,
        encrypted.salt,
        encrypted.iv
      );
      sessionStorage.setItem("bitid-session", password);
      return key;
    } catch (e) {
      return null;
    }
  }

  async autoUnlock(): Promise<CryptoKey | null> {
    const sessionPass = sessionStorage.getItem("bitid-session");
    if (sessionPass) {
      return await this.unlock(sessionPass);
    }
    return null;
  }

  lock() {
    sessionStorage.removeItem("bitid-session");
    localStorage.removeItem("bitid_colleagues_cache");
    this.searchCache.clear();
  }

  async exportIdentity(): Promise<any> {
    const identity = await this.storage.getIdentity();
    const encryptedKey = await this.storage.getEncryptedKey();
    if (!identity || !encryptedKey) return null;

    return {
      identity,
      encryptedPrivateKey: {
        encryptedData: Array.from(new Uint8Array(encryptedKey.encryptedData)),
        salt: Array.from(encryptedKey.salt),
        iv: Array.from(encryptedKey.iv)
      }
    };
  }

  /**
   * Devuelve la lista de compañeros de empresa.
   * Utiliza localStorage con un TTL de 24 horas para evitar peticiones redundantes.
   */
  async getColleagues(): Promise<any[]> {
    // 1. Comprobar caché local (24 horas)
    try {
      const cached = localStorage.getItem("bitid_colleagues_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.ts < this.COLLEAGUES_TTL) {
          return parsed.data;
        }
      }
    } catch (e) {
      // Ignorar errores de parseo
    }

    const id = await this.getIdentity();
    if (!id) return [];

    try {
      // 2. Obtener mis empresas
      const resCompanies = await fetch(
        `${this.apiUrl}/companies/${encodeURIComponent(id.publicKey)}`,
        { signal: AbortSignal.timeout(8000) }
      );

      if (!resCompanies.ok) {
        console.warn(`[BitID] /companies returned ${resCompanies.status}`);
        return [];
      }

      const companies = await resCompanies.json();
      if (!Array.isArray(companies) || companies.length === 0) {
        const empty: any[] = [];
        localStorage.setItem("bitid_colleagues_cache", JSON.stringify({ data: empty, ts: Date.now() }));
        return empty;
      }

      // 3. Obtener miembros de todas mis empresas en paralelo
      const memberRequests = companies.map((comp: any) =>
        fetch(`${this.apiUrl}/companies/${comp.id}/members`, {
          signal: AbortSignal.timeout(8000),
        })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
      );

      const memberGroups = await Promise.all(memberRequests);
      const allMembers: any[] = memberGroups.flatMap((members: any[]) =>
        Array.isArray(members)
          ? members.filter((m: any) => m.public_key !== id.publicKey)
          : []
      );

      // Eliminar duplicados si un usuario está en varias empresas
      const unique = Array.from(
        new Map(allMembers.map((m) => [m.public_key, m])).values()
      );

      localStorage.setItem("bitid_colleagues_cache", JSON.stringify({ data: unique, ts: Date.now() }));
      return unique;
    } catch (err) {
      console.warn("[BitID] getColleagues failed:", err);
      // Fallback a caché expirado si existe
      try {
        const cached = localStorage.getItem("bitid_colleagues_cache");
        if (cached) return JSON.parse(cached).data;
      } catch (e) {}
      return [];
    }
  }

  /**
   * Busca usuarios por username en la API.
   * Incluye caché de 2 min para evitar llamadas duplicadas al escribir.
   */
  async searchUsers(query: string): Promise<any[]> {
    if (!query || query.trim().length < 2) return [];

    const key = query.trim().toLowerCase();

    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.ts < this.SEARCH_TTL) {
      return cached.data;
    }

    try {
      const res = await fetch(
        `${this.apiUrl}/users/search?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(8000) }
      );

      if (!res.ok) {
        console.warn(`[BitID] /users/search returned ${res.status}`);
        return [];
      }

      const data = await res.json();
      const results = Array.isArray(data) ? data : [];

      this.searchCache.set(key, { data: results, ts: Date.now() });
      return results;
    } catch (err) {
      console.warn("[BitID] searchUsers failed:", err);
      return [];
    }
  }
}
