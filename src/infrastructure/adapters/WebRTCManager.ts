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
  private onIncomingOfferCb?: (fromId: string, offer: any) => void;

  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private processedSignals: Set<string> = new Set();
  private localStream?: MediaStream;

  constructor(namespace: string) {
    this.signaling = new FirebaseRTCProvider(namespace);
  }

  async initialize(myId: string) {
    this.myId = myId;
    this.signaling.listenForSignals(myId, async (fromId, signal) => {
      // Evitar procesar lo mismo varias veces
      const signalKey = `${fromId}-${signal.type}-${signal.timestamp}`;
      if (this.processedSignals.has(signalKey)) return;
      this.processedSignals.add(signalKey);
      setTimeout(() => this.processedSignals.delete(signalKey), 10000);

      await this.handleSignal(fromId, signal);
    });
  }

  setLocalStream(stream: MediaStream) {
    this.localStream = stream;
    this.peerConnections.forEach(pc => {
      stream.getTracks().forEach(track => {
        if (!pc.getSenders().find(s => s.track?.id === track.id)) {
          pc.addTrack(track, stream);
        }
      });
    });
  }

  private async handleSignal(fromId: string, signal: SignalMessage) {
    let pc = this.peerConnections.get(fromId);

    try {
      if (signal.type === 'offer') {
        // Lógica de "Polite Peer" para evitar Glare
        const isPolite = this.myId < fromId;
        const hasOfferInProgress = pc && (pc.signalingState !== 'stable' || this.dataChannels.has(fromId));
        
        if (hasOfferInProgress && !isPolite) {
           console.log(`[WebRTC] Glare detected, ignoring offer from ${fromId}`);
           return;
        }

        if (this.onIncomingOfferCb) {
          this.onIncomingOfferCb(fromId, signal.data);
        } else {
          // Si no hay callback de oferta (es P2P puro), auto-respondemos
          await this.createAnswer(fromId, signal.data);
        }

      } else if (signal.type === 'answer') {
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
          const candidates = this.pendingCandidates.get(fromId) || [];
          for (const cand of candidates) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
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
      console.error(`[WebRTC] Signal Error:`, err);
    }
  }

  async createAnswer(fromId: string, offer: any) {
    const pc = this.createPeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const candidates = this.pendingCandidates.get(fromId) || [];
    for (const cand of candidates) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    this.pendingCandidates.delete(fromId);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.signaling.sendSignal(fromId, this.myId, { type: 'answer', from: this.myId, data: answer });
  }

  private createPeerConnection(targetId: string): RTCPeerConnection {
    if (this.peerConnections.has(targetId)) return this.peerConnections.get(targetId)!;

    const pc = new RTCPeerConnection(this.iceServers);
    this.peerConnections.set(targetId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream!));
    }

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Track received from ${targetId}:`, event.track.kind);
      if (this.onRemoteStreamCb) {
        // Asegurar que tenemos un stream. Si el navegador no lo da, creamos uno.
        const stream = event.streams[0] || new MediaStream([event.track]);
        this.onRemoteStreamCb(targetId, stream);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendSignal(targetId, this.myId, { type: 'candidate', from: this.myId, data: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      // IMPORTANTE: No cerrar en 'disconnected', es normal que parpadee. 
      // Solo cerrar en 'failed'.
      if (pc.connectionState === 'connected') {
        this.onConnectionOpenedCb?.(targetId);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
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
    channel.onclose = () => this.onConnectionClosedCb?.(targetId);
  }

  async connect(targetId: string, stream?: MediaStream) {
    if (stream) this.localStream = stream;
    const pc = this.createPeerConnection(targetId);
    
    // Si ya estamos conectando, no envíes otra oferta
    if (pc.signalingState !== 'stable') return;

    // Asegurar que todos los tracks locales están en esta PC
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        if (!pc.getSenders().find(s => s.track?.id === track.id)) {
           pc.addTrack(track, this.localStream!);
        }
      });
    }

    const channel = pc.createDataChannel('chat');
    this.setupDataChannel(targetId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.signaling.sendSignal(targetId, this.myId, { type: 'offer', from: this.myId, data: offer });
  }

  send(targetId: string, data: any) {
    const channel = this.dataChannels.get(targetId);
    if (channel?.readyState === 'open') {
      channel.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
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
  onIncomingOffer(cb: (id: string, offer: any) => void) { this.onIncomingOfferCb = cb; }

  disconnect() {
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.processedSignals.clear();
  }
  getPeerConnection(targetId: string) { return this.peerConnections.get(targetId); }
}
