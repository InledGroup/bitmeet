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

  // ─── Caché en memoria ──────────────────────────────────────────────────────
  // Evita saturar la API con llamadas repetidas en cada tick del setInterval.
  // TTL: 5 minutos para colleagues, 2 minutos para búsquedas.
  private colleaguesCache: { data: any[]; ts: number } | null = null;
  private readonly COLLEAGUES_TTL = 5 * 60 * 1000; // 5 min

  private searchCache = new Map<string, { data: any[]; ts: number }>();
  private readonly SEARCH_TTL = 2 * 60 * 1000; // 2 min
  // ───────────────────────────────────────────────────────────────────────────

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
    this.colleaguesCache = null;
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
    this.colleaguesCache = null;
    this.searchCache.clear();
  }

  /**
   * Devuelve la lista de compañeros de empresa.
   *
   * ┌─ Flujo de llamadas (sin caché) ──────────────────────────────────┐
   * │ GET /companies/{publicKey}         → lista de empresas del usuario│
   * │ GET /companies/{companyId}/members → miembros de cada empresa     │
   * └───────────────────────────────────────────────────────────────────┘
   *
   * Con el caché TTL de 5 min, estas llamadas se hacen UNA vez cada
   * 5 minutos en lugar de cada 10 segundos. Reducción del 97% de tráfico.
   */
  async getColleagues(): Promise<any[]> {
    // Devolver caché si está fresco
    if (
      this.colleaguesCache &&
      Date.now() - this.colleaguesCache.ts < this.COLLEAGUES_TTL
    ) {
      return this.colleaguesCache.data;
    }

    const id = await this.getIdentity();
    if (!id) return [];

    try {
      // 1. Obtener mis empresas
      const resCompanies = await fetch(
        `${this.apiUrl}/companies/${encodeURIComponent(id.publicKey)}`,
        { signal: AbortSignal.timeout(8000) }
      );

      if (!resCompanies.ok) {
        console.warn(`[BitID] /companies returned ${resCompanies.status}`);
        return this.colleaguesCache?.data ?? [];
      }

      const companies = await resCompanies.json();
      if (!Array.isArray(companies) || companies.length === 0) {
        this.colleaguesCache = { data: [], ts: Date.now() };
        return [];
      }

      // 2. Obtener miembros de todas mis empresas en paralelo
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

      this.colleaguesCache = { data: unique, ts: Date.now() };
      return unique;
    } catch (err) {
      console.warn("[BitID] getColleagues failed:", err);
      // Si hay error de red, devolver lo último cacheado (o vacío)
      return this.colleaguesCache?.data ?? [];
    }
  }

  /**
   * Busca usuarios por username en la API.
   * Incluye caché de 2 min para evitar llamadas duplicadas al escribir.
   */
  async searchUsers(query: string): Promise<any[]> {
    if (!query || query.trim().length < 2) return [];

    const key = query.trim().toLowerCase();

    // Devolver caché si está fresco
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

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        console.warn("[BitID] /users/search returned non-JSON response");
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
