export class IndexedDBIdentityStorage {
  private dbName = "BitID_DB";
  private storeName = "identity";
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 2);
      request.onupgradeneeded = (e: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  }

  async getIdentity(): Promise<any | null> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readonly");
    return await this.promisify(tx.objectStore(this.storeName).get("metadata"));
  }

  async getEncryptedKey(): Promise<any | null> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readonly");
    return await this.promisify(tx.objectStore(this.storeName).get("encryptedPrivateKey"));
  }

  async saveIdentity(identity: any, encryptedKey: any): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    await Promise.all([
      this.promisify(store.put(identity, "metadata")),
      this.promisify(store.put(encryptedKey, "encryptedPrivateKey")),
    ]);
  }

  private promisify(request: IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
