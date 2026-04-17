import type { Participant, MeetingMessage } from "./domain";

export interface IWebRTCMediaTransport {
  initialize(participantId: string, existingPeer?: any): Promise<string>; // Returns peerId
  setLocalStream(stream: MediaStream): void;
  connect(peerId: string, stream: MediaStream, initialData: Partial<Participant>): void;
  answer(call: any, stream: MediaStream): void;
  broadcastData(data: any): void;
  sendToPeer(peerId: string, data: any): void;
  replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): void;
  onRemoteStream(callback: (peerId: string, stream: MediaStream, data: any) => void): void;
  onIncomingCall(callback: (call: any) => void): void;
  onDataReceived(callback: (peerId: string, data: any) => void): void;
  onConnectionOpened(callback: (peerId: string) => void): void;
  onConnectionClosed(callback: (peerId: string) => void): void;
  disconnect(): void;
}

export interface ISignalingProvider {
  joinRoom(roomId: string, participantId: string, data: Partial<Participant>): Promise<void>;
  leaveRoom(roomId: string, participantId: string): Promise<void>;
  updateParticipant(roomId: string, participantId: string, data: Partial<Participant>): Promise<void>;
  onParticipantsUpdate(roomId: string, callback: (changes: { type: 'added' | 'modified' | 'removed', id: string, data: any }[]) => void): () => void;
}
