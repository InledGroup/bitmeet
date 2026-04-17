import type { Chat, Message } from "../../core/chat/domain";
import type { IChatRepository } from "../../core/chat/ports";

export class IndexedDBChatRepository implements IChatRepository {
  private dbName = "BitMeet_Chats";
  private storeName = "chats";
  private contactsStore = "contacts";
  private fileDataStore = "file_data"; // Nuevo almacén para los blobs cifrados
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 3); // Subimos versión
      request.onupgradeneeded = (e: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(this.contactsStore)) {
          db.createObjectStore(this.contactsStore, { keyPath: "publicKey" });
        }
        if (!db.objectStoreNames.contains(this.fileDataStore)) {
          db.createObjectStore(this.fileDataStore, { keyPath: "msgId" });
        }
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  }

  async saveFileData(msgId: string, data: ArrayBuffer, magnetURI?: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.fileDataStore, "readwrite");
    await this.promisify(tx.objectStore(this.fileDataStore).put({ msgId, data, magnetURI, timestamp: Date.now() }));
  }

  async getFileData(msgId: string): Promise<ArrayBuffer | null> {
    const db = await this.getDB();
    const tx = db.transaction(this.fileDataStore, "readonly");
    const res = await this.promisify(tx.objectStore(this.fileDataStore).get(msgId));
    return res ? res.data : null;
  }

  async listRecentFiles(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<any[]> {
    const db = await this.getDB();
    const tx = db.transaction(this.fileDataStore, "readonly");
    const all = await this.promisify(tx.objectStore(this.fileDataStore).getAll());
    const now = Date.now();
    return all.filter((f: any) => (now - f.timestamp) < maxAgeMs);
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
    console.log("[IndexedDBChatRepository] listAllChats total:", all.length, all);
    return all.sort((a: Chat, b: Chat) => b.lastUpdate - a.lastUpdate);
  }

  async updateGroupMetadata(groupId: string, data: { name?: string, participants?: string[], owner?: string }): Promise<void> {
    const chat = await this.getChat(groupId);
    if (chat && chat.type === "group") {
      if (data.name) chat.name = data.name;
      if (data.participants) chat.participants = data.participants;
      if (data.owner) chat.owner = data.owner;
      await this.saveChat(chat);
    }
  }

  async addMessage(chatId: string, message: Message): Promise<void> {
    const chat = await this.getChat(chatId);
    if (chat) {
      // Evitar duplicados por ID
      if (chat.messages.find(m => m.id === message.id)) {
        return;
      }
      chat.messages.push(message);
      // Mantener mensajes ordenados por timestamp
      chat.messages.sort((a, b) => a.timestamp - b.timestamp);
      
      // Actualizar fecha del chat
      chat.lastUpdate = Math.max(chat.lastUpdate, message.timestamp);
      
      // Manejar mensajes de sistema para actualizar metadata del grupo
      if (chat.type === "group" && message.type === "system") {
        try {
          const content = JSON.parse(message.content);
          if (message.systemAction === "group_renamed" && content.newName) {
            chat.name = content.newName;
          } else if ((message.systemAction === "member_added" || message.systemAction === "member_removed" || message.systemAction === "member_left") && content.participants) {
            chat.participants = content.participants;
          }
        } catch (e) {
          console.warn("Error parseando mensaje de sistema:", e);
        }
      }

      chat.messages.sort((a, b) => a.timestamp - b.timestamp);
      chat.lastUpdate = Math.max(chat.lastUpdate, message.timestamp);
      await this.saveChat(chat);
    } else {
      // Si no existe el chat, crearlo implícitamente
      const isGroup = !!message.groupId;
      let participants = isGroup 
        ? [message.senderPubKey] 
        : [message.senderPubKey, message.receiverPubKey!];

      let name = isGroup ? (message.senderUsername ? `Grupo de ${message.senderUsername}` : "Nuevo Grupo") : undefined;
      let owner = isGroup ? message.senderPubKey : undefined;

      // Si es un mensaje del sistema de creación de grupo, extraemos los datos reales.
      if (isGroup && message.type === "system" && message.systemAction === "group_created") {
        try {
          const content = JSON.parse(message.content);
          if (content.participants) participants = content.participants;
          if (content.name) name = content.name;
          if (content.owner) owner = content.owner;
        } catch (e) {}
      }

      const newChat: Chat = {
        id: chatId,
        participants,
        messages: [message],
        type: isGroup ? "group" : "direct",
        name,
        owner,
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

  async markAsRead(chatId: string): Promise<void> {
    const chat = await this.getChat(chatId);
    if (chat) {
      const lastMsgTs = chat.messages.length > 0 ? Math.max(...chat.messages.map(m => m.timestamp)) : 0;
      chat.lastReadTimestamp = Math.max(Date.now(), lastMsgTs);
      await this.saveChat(chat);
    }
  }

  async markAllAsRead(): Promise<void> {
    const chats = await this.listAllChats();
    for (const chat of chats) {
      const lastMsgTs = chat.messages.length > 0 ? Math.max(...chat.messages.map(m => m.timestamp)) : 0;
      chat.lastReadTimestamp = Math.max(Date.now(), lastMsgTs);
      await this.saveChat(chat);
    }
  }

  private promisify(request: IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
