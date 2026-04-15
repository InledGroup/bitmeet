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

  async importIdentity(data: any): Promise<void> {
    const identity = data.identity || data.metadata;
    const encrypted = data.encryptedPrivateKey;

    if (!identity || !encrypted) {
      throw new Error("Invalid identity format");
    }

    // Convert potential arrays to Uint8Array/ArrayBuffer if needed
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
  }

  async getIdentity(): Promise<BitID | null> {
    const identity = await this.storage.getIdentity();
    if (!identity) return null;
    return {
      username: identity.username,
      publicKey: identity.publicKey
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
      sessionStorage.setItem('bitid-session', password);
      return key;
    } catch (e) {
      return null;
    }
  }

  async autoUnlock(): Promise<CryptoKey | null> {
    const sessionPass = sessionStorage.getItem('bitid-session');
    if (sessionPass) {
      return await this.unlock(sessionPass);
    }
    return null;
  }

  lock() {
    sessionStorage.removeItem('bitid-session');
  }

  async getColleagues(): Promise<any[]> {
    const id = await this.getIdentity();
    if (!id) return [];

    // 1. Obtener mis empresas
    const resCompanies = await fetch(`${this.apiUrl}/companies/${encodeURIComponent(id.publicKey)}`);
    const companies = await resCompanies.json();

    // 2. Obtener miembros de todas mis empresas
    const allMembers: any[] = [];
    for (const comp of companies) {
      const resMembers = await fetch(`${this.apiUrl}/companies/${comp.id}/members`);
      const members = await resMembers.json();
      allMembers.push(...members.filter((m: any) => m.public_key !== id.publicKey));
    }

    // Eliminar duplicados si un usuario está en varias empresas
    return Array.from(new Map(allMembers.map(m => [m.public_key, m])).values());
  }

  async searchUsers(query: string): Promise<any[]> {
    const res = await fetch(`${this.apiUrl}/users/search?q=${encodeURIComponent(query)}`);
    return await res.json();
  }
}
