import type { CallRecord } from "../../core/calls/domain";
import type { ICallsRepository } from "../../core/calls/ports";

export class IndexedDBCallsRepository implements ICallsRepository {
  private dbName = "BitMeet_Calls";
  private storeName = "calls";
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  }

  async addCallRecord(record: CallRecord): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readwrite");
    await this.promisify(tx.objectStore(this.storeName).put(record));
  }

  async listCallHistory(): Promise<CallRecord[]> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readonly");
    const all = await this.promisify(tx.objectStore(this.storeName).getAll());
    return all.sort((a: any, b: any) => b.startTime - a.startTime);
  }

  async clearHistory(): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readwrite");
    await this.promisify(tx.objectStore(this.storeName).clear());
  }

  private promisify(request: IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
