import { WebRTCManager } from './WebRTCManager';
import type { IWebRTCMediaTransport } from '../../core/webrtc/ports';

export class PeerJSMediaTransport implements IWebRTCMediaTransport {
  private webrtc: WebRTCManager;
  private peerId: string | null = null;
  private onRemoteStreamCb?: (peerId: string, stream: MediaStream, data: any) => void;
  private onIncomingCallCb?: (call: any) => void;
  private onDataReceivedCb?: (peerId: string, data: any) => void;
  private onConnectionOpenedCb?: (peerId: string) => void;
  private onConnectionClosedCb?: (peerId: string) => void;

  constructor() {
    this.webrtc = new WebRTCManager();
    this.webrtc.onDataReceived((fromId, data) => {
      if (this.onDataReceivedCb) this.onDataReceivedCb(fromId, data);
    });
    this.webrtc.onConnectionOpened((id) => {
      if (this.onConnectionOpenedCb) this.onConnectionOpenedCb(id);
    });
    this.webrtc.onConnectionClosed((id) => {
      if (this.onConnectionClosedCb) this.onConnectionClosedCb(id);
    });
    this.webrtc.onRemoteStream((id, stream) => {
      if (this.onRemoteStreamCb) this.onRemoteStreamCb(id, stream, { id });
    });
    this.webrtc.onIncomingConnection((fromId) => {
      if (this.onIncomingCallCb) {
        // Mocking PeerJS call object
        this.onIncomingCallCb({
          peer: fromId,
          answer: (stream: MediaStream) => this.answer({ peer: fromId }, stream),
          on: (event: string, cb: any) => {
            if (event === 'stream') {
              this.webrtc.onRemoteStream((id, remoteStream) => {
                if (id === fromId) cb(remoteStream);
              });
            }
          }
        });
      }
    });
  }

  getPeer() {
    // Mocking PeerJS object for compatibility
    return {
      id: this.peerId,
      on: (event: string, cb: any) => {
        if (event === 'call') this.onIncomingCallCb = cb;
      }
    };
  }

  getPeerId() {
    return this.peerId;
  }

  async initialize(participantId: string, existingPeer?: any): Promise<string> {
    // Ya no usamos hash determinístico para evitar discrepancias con el ID de Firebase
    this.peerId = participantId;
    await this.webrtc.initialize(participantId);
    
    console.log('[BitMeet] WebRTC (Firebase) Initialized with ID:', participantId);
    return participantId;
  }

  connect(peerId: string, stream: MediaStream, initialData: any): void {
    // Aseguramos que pasamos el stream inicial si existe
    this.webrtc.connect(peerId, stream);
  }

  answer(call: any, stream: MediaStream): void {
    // En nuestra implementación manual, el stream se añade al PC existente
    this.webrtc.addStream(call.peer, stream);
  }

  broadcastData(data: any): void {
    // Not implemented in WebRTCManager yet, but could iterate connections
  }

  sendToPeer(peerId: string, data: any): void {
    this.webrtc.send(peerId, data);
  }

  replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): void {
    // Iterate over all peer connections and replace tracks
  }

  onRemoteStream(callback: (peerId: string, stream: MediaStream, data: any) => void): void {
    this.onRemoteStreamCb = callback;
  }

  onIncomingCall(callback: (call: any) => void): void {
    this.onIncomingCallCb = callback;
  }

  onDataReceived(callback: (peerId: string, data: any) => void): void {
    this.onDataReceivedCb = callback;
  }

  onConnectionOpened(callback: (peerId: string) => void): void {
    this.onConnectionOpenedCb = callback;
  }

  onConnectionClosed(callback: (peerId: string) => void): void {
    this.onConnectionClosedCb = callback;
  }

  disconnect(): void {
    this.webrtc.disconnect();
  }
}
