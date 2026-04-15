export type MessageType = "text" | "file" | "system";

export interface Message {
  id: string;
  senderPubKey: string;
  senderUsername?: string;
  receiverPubKey?: string; // Si es 1:1
  groupId?: string; // Si es grupo
  content: string; // Cifrado (o JSON string para system)
  timestamp: number;
  type: MessageType;
  status: "pending" | "sent" | "received" | "read";
  iv: string; // Vector de inicialización para el cifrado
  systemAction?: "group_created" | "group_renamed" | "member_added" | "member_removed" | "member_left";
}

export interface Chat {
  id: string; 
  participants: string[]; // publicKeys
  messages: Message[];
  type: "direct" | "group";
  name?: string;
  owner?: string; // publicKey del creador del grupo
  lastReadTimestamp?: number;
  lastUpdate: number;
}
