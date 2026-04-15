import type { Message, Chat } from "./domain";

export interface IChatRepository {
  saveChat(chat: Chat): Promise<void>;
  getChat(chatId: string): Promise<Chat | null>;
  listAllChats(): Promise<Chat[]>;
  addMessage(chatId: string, message: Message): Promise<void>;
  updateMessageStatus(chatId: string, messageId: string, status: Message["status"]): Promise<void>;
}

export interface IP2PTransport {
  connect(targetPubKey: string): Promise<void>;
  disconnect(): void;
  sendMessage(message: Message): Promise<void>;
  onMessageReceived(callback: (message: Message) => void): void;
  onPresenceUpdate(callback: (pubKey: string, status: "online" | "offline") => void): void;
  registerPresence(pubKey: string): Promise<void>;
}
