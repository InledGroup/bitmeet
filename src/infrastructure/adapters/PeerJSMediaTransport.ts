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
    this.webrtc = new WebRTCManager('calls');
    
    this.webrtc.onRemoteStream((id, stream) => {
      if (this.onRemoteStreamCb) this.onRemoteStreamCb(id, stream, { id });
    });

    this.webrtc.onIncomingConnection((fromId) => {
      const call = {
        peer: fromId,
        answer: (stream: MediaStream) => this.answer({ peer: fromId }, stream),
        on: (event: string, cb: any) => {
          if (event === 'stream') {
            this.webrtc.onRemoteStream((id, remoteStream) => {
              if (id === fromId) cb(remoteStream);
            });
          }
        },
        close: () => {
          this.webrtc.disconnect();
        }
      };

      if (this.onIncomingCallCb) this.onIncomingCallCb(call);
    });

    this.webrtc.onDataReceived((id, data) => {
      if (this.onDataReceivedCb) this.onDataReceivedCb(id, data);
    });

    this.webrtc.onConnectionOpened((id) => {
      if (this.onConnectionOpenedCb) this.onConnectionOpenedCb(id);
    });

    this.webrtc.onConnectionClosed((id) => {
      if (this.onConnectionClosedCb) this.onConnectionClosedCb(id);
    });
  }

  private async hashId(id: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(id);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  getPeer() {
    return {
      id: this.peerId,
      on: (event: string, cb: any) => {
        if (event === 'call') this.onIncomingCall(cb);
      }
    };
  }

  getPeerId() {
    return this.peerId;
  }

  async initialize(participantId: string, existingPeer?: any): Promise<string> {
    // IMPORTANTE: Unificamos a Hashed ID para evitar colisiones y rutas inválidas en Firebase
    this.peerId = participantId.length > 16 ? await this.hashId(participantId) : participantId;
    await this.webrtc.initialize(this.peerId);
    console.log('[BitMeet] PeerJS-Like Transport Initialized with Hashed ID:', this.peerId);
    return this.peerId;
  }

  setLocalStream(stream: MediaStream) {
    this.webrtc.setLocalStream(stream);
  }

  async connect(targetId: string, stream: MediaStream, initialData: any): Promise<void> {
    // Si targetId es una public key larga, la hasheamos
    const targetHash = targetId.length > 16 ? await this.hashId(targetId) : targetId;
    console.log('[BitMeet] Connecting to hashed target:', targetHash);
    this.webrtc.connect(targetHash, stream);
  }

  answer(call: any, stream: MediaStream): void {
    console.log('[BitMeet] Answering call from:', call.peer);
    this.webrtc.setLocalStream(stream);
  }

  broadcastData(data: any): void {
    // No implementado para calls por ahora
  }

  sendToPeer(peerId: string, data: any): void {
    this.webrtc.send(peerId, data);
  }

  replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): void {
    // Implementación simplificada: actualizar el localStream
    if ((window as any).localStream) {
        this.webrtc.setLocalStream((window as any).localStream);
    }
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
