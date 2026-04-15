import Peer, { type DataConnection } from 'peerjs';
import type { IWebRTCMediaTransport } from '../../core/webrtc/ports';

export class PeerJSMediaTransport implements IWebRTCMediaTransport {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private calls: Map<string, any> = new Map();
  private onRemoteStreamCb?: (peerId: string, stream: MediaStream, data: any) => void;
  private onIncomingCallCb?: (call: any) => void;
  private onDataReceivedCb?: (peerId: string, data: any) => void;
  private onConnectionOpenedCb?: (peerId: string) => void;
  private onConnectionClosedCb?: (peerId: string) => void;

  async initialize(participantId: string, existingPeer?: any): Promise<string> {
    if (existingPeer) {
      this.peer = existingPeer;
      // Setup listeners on existing peer
      this.peer.on('connection', (conn: any) => {
        this.setupDataConnection(conn);
      });
      this.peer.on('call', (call: any) => {
        if (this.onIncomingCallCb) this.onIncomingCallCb(call);
      });

      return existingPeer.id;
    }

    // Usamos el mismo método de hashing que P2PTransport para que los IDs coincidan
    const msgUint8 = new TextEncoder().encode(participantId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const deterministicId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);

    this.peer = new Peer(deterministicId, {
      debug: 2
    });
    
    return new Promise((resolve, reject) => {
      this.peer?.on('open', (id: string) => {
        console.log('[BitMeet] PeerJS Initialized with Deterministic ID:', id);
        
        this.peer?.on('connection', (conn) => {
          this.setupDataConnection(conn);
        });

        this.peer?.on('call', (call) => {
          console.log('[BitMeet] Incoming call from:', call.peer);
          if (this.onIncomingCallCb) {
            this.onIncomingCallCb(call);
          }
        });

        resolve(id);
      });

      this.peer?.on('error', (err) => {
        console.error('[BitMeet] PeerJS Error:', err);
        reject(err);
      });
    });
  }

  connect(peerId: string, stream: MediaStream, initialData: any): void {
    if (!this.peer || this.calls.has(peerId)) return;

    // Connect Data
    const conn = this.peer.connect(peerId);
    this.setupDataConnection(conn);

    // Connect Media
    const call = this.peer.call(peerId, stream);
    this.calls.set(peerId, call);
    
    call.on('stream', (remoteStream: MediaStream) => {
      if (this.onRemoteStreamCb) {
        this.onRemoteStreamCb(peerId, remoteStream, initialData);
      }
    });

    call.on('close', () => {
      this.calls.delete(peerId);
      if (this.onConnectionClosedCb) this.onConnectionClosedCb(peerId);
    });
  }

  answer(call: any, stream: MediaStream): void {
    console.log('[BitMeet] Answering call from:', call.peer);
    call.answer(stream);
    this.calls.set(call.peer, call);
    
    call.on('stream', (remoteStream: MediaStream) => {
      console.log('[BitMeet] Remote stream received in answer from:', call.peer);
      if (this.onRemoteStreamCb) {
        this.onRemoteStreamCb(call.peer, remoteStream, { id: call.peer });
      }
    });

    call.on('close', () => {
      console.log('[BitMeet] Call closed from:', call.peer);
      this.calls.delete(call.peer);
      if (this.onConnectionClosedCb) this.onConnectionClosedCb(call.peer);
    });

    call.on('error', (err: any) => {
      console.error('[BitMeet] Call error:', err);
    });
  }

  broadcastData(data: any): void {
    this.connections.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  }

  sendToPeer(peerId: string, data: any): void {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send(data);
    }
  }

  replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): void {
    this.calls.forEach(call => {
      if (call.peerConnection) {
        const sender = call.peerConnection.getSenders().find((s: any) => s.track?.kind === oldTrack.kind);
        if (sender) {
          sender.replaceTrack(newTrack);
        }
      }
    });
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

  private setupDataConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      if (this.onConnectionOpenedCb) {
        this.onConnectionOpenedCb(conn.peer);
      }
    });

    conn.on('data', (data: any) => {
      if (this.onDataReceivedCb) {
        this.onDataReceivedCb(conn.peer, data);
      }
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      if (this.onConnectionClosedCb) {
        this.onConnectionClosedCb(conn.peer);
      }
    });
  }

  disconnect(): void {
    this.calls.forEach(call => call.close());
    this.connections.forEach(conn => conn.close());
    // In Teams mode, we might be using a shared peer, so we don't destroy it.
    // However, for MeetingContainer standalone mode, this is called.
    // If we want to be safe, we could only destroy if it was created locally.
    this.calls.clear();
    this.connections.clear();
  }
}
