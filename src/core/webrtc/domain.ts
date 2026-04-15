export interface Participant {
  id: string; // publicKey
  peerId: string;
  name: string;
  isLocal: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
  stream?: MediaStream;
}

export interface MeetingMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  encrypted?: boolean;
  iv?: string;
  file?: {
    name: string;
    size: number;
    type: string;
    url?: string;
    magnetURI?: string;
    key?: string;
    iv?: string;
  }
}

export interface MeetingRoom {
  id: string;
  participants: Participant[];
}
