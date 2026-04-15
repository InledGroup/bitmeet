import type { Chat, Message } from "../../core/chat/domain";
import type { IChatRepository } from "../../core/chat/ports";

export class IndexedDBChatRepository implements IChatRepository {
  private dbName = "BitMeet_Chats";
  private storeName = "chats";
  private contactsStore = "contacts";
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 2);
      request.onupgradeneeded = (e: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(this.contactsStore)) {
          db.createObjectStore(this.contactsStore, { keyPath: "publicKey" });
        }
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  }

  async saveContact(contact: { publicKey: string, username: string, isFavorite: boolean }): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.contactsStore, "readwrite");
    await this.promisify(tx.objectStore(this.contactsStore).put(contact));
  }

  async getContact(publicKey: string): Promise<any | null> {
    const db = await this.getDB();
    const tx = db.transaction(this.contactsStore, "readonly");
    const contact = await this.promisify(tx.objectStore(this.contactsStore).get(publicKey));
    return contact || null;
  }

  async listContacts(): Promise<any[]> {
    const db = await this.getDB();
    const tx = db.transaction(this.contactsStore, "readonly");
    return await this.promisify(tx.objectStore(this.contactsStore).getAll());
  }

  async deleteContact(publicKey: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.contactsStore, "readwrite");
    await this.promisify(tx.objectStore(this.contactsStore).delete(publicKey));
  }

  async saveChat(chat: Chat): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readwrite");
    await this.promisify(tx.objectStore(this.storeName).put(chat));
  }

  async getChat(chatId: string): Promise<Chat | null> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readonly");
    const chat = await this.promisify(tx.objectStore(this.storeName).get(chatId));
    return chat || null;
  }

  async listAllChats(): Promise<Chat[]> {
    const db = await this.getDB();
    const tx = db.transaction(this.storeName, "readonly");
    const all = await this.promisify(tx.objectStore(this.storeName).getAll());
    return all.sort((a: Chat, b: Chat) => b.lastUpdate - a.lastUpdate);
  }

  async addMessage(chatId: string, message: Message): Promise<void> {
    const chat = await this.getChat(chatId);
    if (chat) {
      chat.messages.push(message);
      chat.lastUpdate = message.timestamp;
      await this.saveChat(chat);
    } else {
      // Si no existe el chat, crearlo implícitamente
      const newChat: Chat = {
        id: chatId,
        participants: [message.senderPubKey, message.receiverPubKey],
        messages: [message],
        type: "direct",
        lastUpdate: message.timestamp
      };
      await this.saveChat(newChat);
    }
  }

  async updateMessageStatus(chatId: string, messageId: string, status: Message["status"]): Promise<void> {
    const chat = await this.getChat(chatId);
    if (chat) {
      const msg = chat.messages.find(m => m.id === messageId);
      if (msg) {
        msg.status = status;
        await this.saveChat(chat);
      }
    }
  }

  private promisify(request: IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
