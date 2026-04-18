import { WebRTCManager } from './WebRTCManager';
import type { IWebRTCMediaTransport } from '../../core/webrtc/ports';

export class FirebaseMediaTransport implements IWebRTCMediaTransport {
  private manager: WebRTCManager;
  private myId: string = '';

  private onRemoteStreamCb?: (peerId: string, stream: MediaStream, data: any) => void;
  private onDataReceivedCb?: (peerId: string, data: any) => void;
  private onConnectionOpenedCb?: (peerId: string) => void;
  private onConnectionClosedCb?: (peerId: string) => void;

  constructor(roomId: string) {
    // Usamos el roomId como namespace para que las señales de esta llamada 
    // no se mezclen con otras o con el chat P2P.
    this.manager = new WebRTCManager(`calls-${roomId}`);
  }

  async initialize(participantId: string, existingPeer?: any, turnCredentials?: any): Promise<string> {
    this.myId = participantId;

    this.manager.onRemoteStream((id, stream) => {
      this.onRemoteStreamCb?.(id, stream, { id });
    });

    this.manager.onDataReceived((id, data) => {
      this.onDataReceivedCb?.(id, data);
    });

    this.manager.onConnectionOpened((id) => {
      this.onConnectionOpenedCb?.(id);
    });

    this.manager.onConnectionClosed((id) => {
      this.onConnectionClosedCb?.(id);
    });

    await this.manager.initialize(participantId, turnCredentials);
    return participantId;
  }
  connect(peerId: string, stream: MediaStream): void {
    this.manager.setLocalStream(stream);
    this.manager.connect(peerId, stream);
  }

  setLocalStream(stream: MediaStream): void {
    this.manager.setLocalStream(stream);
  }

  sendToPeer(peerId: string, data: any): void {
    this.manager.send(peerId, data);
  }

  broadcastData(data: any): void {
    // WebRTCManager no tiene broadcast nativo, lo implementamos manual
    // Pero para status nos basta con enviar a los conectados
  }

  replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): void {
    // El manager ya maneja tracks en setLocalStream, pero podemos forzar
    this.manager.setLocalStream((window as any).currentCallStream);
  }

  onRemoteStream(cb: any) { this.onRemoteStreamCb = cb; }
  onDataReceived(cb: any) { this.onDataReceivedCb = cb; }
  onConnectionOpened(cb: any) { this.onConnectionOpenedCb = cb; }
  onConnectionClosed(cb: any) { this.onConnectionClosedCb = cb; }
  
  // No usado en este flujo de WebRTC puro
  onIncomingCall(cb: any) {}
  answer(call: any, stream: MediaStream) {}

  disconnect(): void {
    this.manager.disconnect();
  }

  getPeerId() { return this.myId; }
}
