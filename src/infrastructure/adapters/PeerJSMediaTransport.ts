import Peer, { type MediaConnection, type DataConnection } from 'peerjs';
import type { IWebRTCMediaTransport } from '../../core/webrtc/ports';

export class PeerJSMediaTransport implements IWebRTCMediaTransport {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private calls: Map<string, MediaConnection> = new Map();
  private peerId: string | null = null;

  private onRemoteStreamCb?: (peerId: string, stream: MediaStream, data: any) => void;
  private onIncomingCallCb?: (call: any) => void;
  private onDataReceivedCb?: (peerId: string, data: any) => void;
  private onConnectionOpenedCb?: (peerId: string) => void;
  private onConnectionClosedCb?: (peerId: string) => void;

  constructor() {}

  static async hashId(id: string): Promise<string> {
    if (!id || id === 'anonymous') return 'anonymous';
    if (id.length <= 16) return id;
    const msgUint8 = new TextEncoder().encode(id);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  async initialize(participantId: string, existingPeer?: any): Promise<string> {
    // Si pasamos un peer real de PeerJS, lo usamos.
    if (existingPeer && typeof existingPeer.connect === 'function') {
        this.peer = existingPeer;
        this.peerId = existingPeer.id;
        this.setupPeerListeners();
        return existingPeer.id;
    }

    this.peerId = await PeerJSMediaTransport.hashId(participantId);
    
    this.peer = new Peer(this.peerId!, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    return new Promise((resolve) => {
      this.peer?.on('open', (id) => {
        console.log('[BitMeet] PeerJS Call Instance ready:', id);
        this.setupPeerListeners();
        resolve(id);
      });
    });
  }

  private setupPeerListeners() {
    this.peer?.on('call', (call) => {
      if (this.onIncomingCallCb) this.onIncomingCallCb(call);
    });
    this.peer?.on('connection', (conn) => {
      this.setupDataConnection(conn);
    });
    this.peer?.on('error', (err) => {
      console.error('[BitMeet] PeerJS Error:', err);
    });
  }

  private setupDataConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.onConnectionOpenedCb?.(conn.peer);
    });
    conn.on('data', (data) => {
      this.onDataReceivedCb?.(conn.peer, data);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.onConnectionClosedCb?.(conn.peer);
    });
  }

  connect(peerId: string, stream: MediaStream, initialData: any): void {
    if (!this.peer || this.calls.has(peerId)) return;

    const conn = this.peer.connect(peerId, { metadata: initialData });
    this.setupDataConnection(conn);

    const call = this.peer.call(peerId, stream, { metadata: initialData });
    this.setupCall(call, peerId, initialData);
  }

  answer(call: MediaConnection, stream: MediaStream): void {
    call.answer(stream);
    this.setupCall(call, call.peer, call.metadata || { id: call.peer });
  }

  private setupCall(call: MediaConnection, peerId: string, data: any) {
    this.calls.set(peerId, call);
    call.on('stream', (remoteStream) => {
      console.log('[BitMeet] Remote stream received from:', peerId);
      this.onRemoteStreamCb?.(peerId, remoteStream, data);
    });
    call.on('close', () => {
      this.calls.delete(peerId);
      this.onConnectionClosedCb?.(peerId);
    });
  }

  getPeer() { return this.peer; }
  getPeerId() { return this.peerId; }
  setLocalStream(stream: MediaStream) {}
  
  sendToPeer(peerId: string, data: any) {
    const conn = this.connections.get(peerId);
    if (conn?.open) conn.send(data);
  }

  broadcastData(data: any) {
    this.connections.forEach(conn => { if (conn.open) conn.send(data); });
  }

  replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack) {
    this.calls.forEach(call => {
      const sender = call.peerConnection.getSenders().find(s => s.track?.kind === oldTrack.kind);
      if (sender) sender.replaceTrack(newTrack);
    });
  }

  onRemoteStream(cb: any) { this.onRemoteStreamCb = cb; }
  onIncomingCall(cb: any) { this.onIncomingCallCb = cb; }
  onDataReceived(cb: any) { this.onDataReceivedCb = cb; }
  onConnectionOpened(cb: any) { this.onConnectionOpenedCb = cb; }
  onConnectionClosed(cb: any) { this.onConnectionClosedCb = cb; }
  
  disconnect(): void {
    this.calls.forEach(c => c.close());
    this.connections.forEach(c => c.close());
    this.calls.clear();
    this.connections.clear();
  }
}
