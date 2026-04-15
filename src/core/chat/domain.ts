export type MessageType = "text" | "file" | "system";

export interface Message {
  id: string;
  senderPubKey: string;
  receiverPubKey: string; // Si es 1:1, si es grupo usaremos el groupId
  content: string; // Cifrado
  timestamp: number;
  status: "pending" | "sent" | "received" | "read";
  iv: string; // Vector de inicialización para el cifrado
}

export interface Chat {
  id: string; // Generado por el hash de las dos publicKeys en orden alfabético para 1:1
  participants: string[]; // publicKeys
  messages: Message[];
  type: "direct" | "group";
  name?: string;
  lastUpdate: number;
}
