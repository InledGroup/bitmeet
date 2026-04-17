import { FirebaseRTCProvider, type SignalMessage } from './FirebaseRTCProvider';

export class WebRTCManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private signaling: FirebaseRTCProvider;
  private myId: string = '';
  private iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ]
  };

  private onRemoteStreamCb?: (peerId: string, stream: MediaStream) => void;
  private onDataReceivedCb?: (fromId: string, data: any) => void;
  private onConnectionOpenedCb?: (id: string) => void;
  private onConnectionClosedCb?: (id: string) => void;
  private onIncomingConnectionCb?: (fromId: string) => void;

  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private localStream?: MediaStream;

  constructor() {
    this.signaling = new FirebaseRTCProvider();
  }

  async initialize(myId: string) {
    this.myId = myId;
    console.log(`[WebRTC] Listening for ID: ${myId}`);
    this.signaling.listenForSignals(myId, async (fromId, signal) => {
      await this.handleSignal(fromId, signal);
    });
  }

  setLocalStream(stream: MediaStream) {
    this.localStream = stream;
    // Si ya hay conexiones abiertas, inyectar el stream para que no se vea en negro
    this.peerConnections.forEach(pc => {
      stream.getTracks().forEach(track => {
        const alreadyAdded = pc.getSenders().find(s => s.track?.id === track.id);
        if (!alreadyAdded) pc.addTrack(track, stream);
      });
    });
  }

  private async handleSignal(fromId: string, signal: SignalMessage) {
    let pc = this.peerConnections.get(fromId);

    try {
      if (signal.type === 'offer') {
        if (!pc) pc = this.createPeerConnection(fromId);
        
        await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
        
        const candidates = this.pendingCandidates.get(fromId) || [];
        for (const cand of candidates) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        this.pendingCandidates.delete(fromId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.signaling.sendSignal(fromId, this.myId, { type: 'answer', from: this.myId, data: answer });

        if (this.onIncomingConnectionCb) this.onIncomingConnectionCb(fromId);

      } else if (signal.type === 'answer') {
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
          const candidates = this.pendingCandidates.get(fromId) || [];
          for (const cand of candidates) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          this.pendingCandidates.delete(fromId);
        }
      } else if (signal.type === 'candidate') {
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.data)).catch(() => {});
        } else {
          if (!this.pendingCandidates.has(fromId)) this.pendingCandidates.set(fromId, []);
          this.pendingCandidates.get(fromId)!.push(signal.data);
        }
      }
    } catch (err) {
      console.error(`[WebRTC] Error handling signal ${signal.type}:`, err);
    }
  }

  private createPeerConnection(targetId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(this.iceServers);
    this.peerConnections.set(targetId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream!));
    }

    pc.ontrack = (event) => {
      if (this.onRemoteStreamCb && event.streams[0]) {
        this.onRemoteStreamCb(targetId, event.streams[0]);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendSignal(targetId, this.myId, { type: 'candidate', from: this.myId, data: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.onConnectionOpenedCb?.(targetId);
      } else if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.closeConnection(targetId);
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(targetId, event.channel);
    };

    return pc;
  }

  private setupDataChannel(targetId: string, channel: RTCDataChannel) {
    this.dataChannels.set(targetId, channel);
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onDataReceivedCb?.(targetId, data);
      } catch (e) {
        this.onDataReceivedCb?.(targetId, event.data);
      }
    };
    channel.onopen = () => this.onConnectionOpenedCb?.(targetId);
  }

  async connect(targetId: string, stream?: MediaStream) {
    if (this.peerConnections.has(targetId)) return;
    if (stream) this.localStream = stream;

    const pc = this.createPeerConnection(targetId);
    const channel = pc.createDataChannel('chat');
    this.setupDataChannel(targetId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.signaling.sendSignal(targetId, this.myId, { type: 'offer', from: this.myId, data: offer });
  }

  send(targetId: string, data: any) {
    const channel = this.dataChannels.get(targetId);
    if (channel && channel.readyState === 'open') {
      channel.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  getPeerConnection(targetId: string): RTCPeerConnection | undefined {
    return this.peerConnections.get(targetId);
  }

  private closeConnection(targetId: string) {
    const pc = this.peerConnections.get(targetId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(targetId);
    }
    this.dataChannels.delete(targetId);
    this.onConnectionClosedCb?.(targetId);
  }

  onRemoteStream(cb: (id: string, s: MediaStream) => void) { this.onRemoteStreamCb = cb; }
  onDataReceived(cb: (id: string, d: any) => void) { this.onDataReceivedCb = cb; }
  onConnectionOpened(cb: (id: string) => void) { this.onConnectionOpenedCb = cb; }
  onConnectionClosed(cb: (id: string) => void) { this.onConnectionClosedCb = cb; }
  onIncomingConnection(cb: (id: string) => void) { this.onIncomingConnectionCb = cb; }

  disconnect() {
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.dataChannels.clear();
  }
}
