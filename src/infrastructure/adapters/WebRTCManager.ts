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
    ]
  };

  private onDataReceivedCb?: (fromId: string, data: any) => void;
  private onConnectionOpenedCb?: (id: string) => void;
  private onConnectionClosedCb?: (id: string) => void;
  private onRemoteStreamCb?: (peerId: string, stream: MediaStream) => void;
  private onIncomingConnectionCb?: (fromId: string) => void;

  private processedSignals: Set<string> = new Set();
  private makingOffer: Map<string, boolean> = new Map();
  private ignoreOffer: Map<string, boolean> = new Map();

  constructor() {
    this.signaling = new FirebaseRTCProvider();
  }

  async initialize(myId: string) {
    this.myId = myId;
    this.signaling.listenForSignals(myId, async (fromId, signal) => {
      const signalKey = `${fromId}-${signal.type}-${signal.timestamp}`;
      if (this.processedSignals.has(signalKey)) return;
      this.processedSignals.add(signalKey);

      await this.handleSignal(fromId, signal);
    });
  }

  onDataReceived(cb: (fromId: string, data: any) => void) { this.onDataReceivedCb = cb; }
  onConnectionOpened(cb: (id: string) => void) { this.onConnectionOpenedCb = cb; }
  onConnectionClosed(cb: (id: string) => void) { this.onConnectionClosedCb = cb; }
  onRemoteStream(cb: (peerId: string, stream: MediaStream) => void) { this.onRemoteStreamCb = cb; }
  onIncomingConnection(cb: (fromId: string) => void) { this.onIncomingConnectionCb = cb; }

  private async handleSignal(fromId: string, signal: SignalMessage) {
    console.log(`[WebRTC Debug] Signal received: ${signal.type} from ${fromId}. SignalingState: ${this.peerConnections.get(fromId)?.signalingState}`);
    let pc = this.peerConnections.get(fromId);

    try {
      if (signal.type === 'offer') {
        const polite = this.myId > fromId;
        const offerCollision = this.makingOffer.get(fromId) || (pc && pc.signalingState !== 'stable');
        
        this.ignoreOffer.set(fromId, !polite && offerCollision);
        if (this.ignoreOffer.get(fromId)) {
          console.log(`[WebRTC Debug] Glare detected: Ignoring offer from ${fromId}`);
          return;
        }

        if (!pc) {
          console.log(`[WebRTC Debug] Creating PC for incoming offer from ${fromId}`);
          pc = this.createPeerConnection(fromId);
          if (this.onIncomingConnectionCb) this.onIncomingConnectionCb(fromId);
        }

        await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
        console.log(`[WebRTC Debug] Remote description set for ${fromId}. Creating answer...`);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.signaling.sendSignal(fromId, this.myId, { type: 'answer', from: this.myId, data: answer });

      } else if (signal.type === 'answer') {
        if (pc) {
          console.log(`[WebRTC Debug] Setting answer from ${fromId}`);
          await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
        }
      } else if (signal.type === 'candidate') {
        if (pc) {
          try {
            if (signal.data && (signal.data.sdpMid !== null || signal.data.sdpMLineIndex !== null)) {
              await pc.addIceCandidate(new RTCIceCandidate(signal.data));
            }
          } catch (e) {
            console.error(`[WebRTC Debug] Error adding ICE candidate from ${fromId}:`, e);
          }
        }
      }
    } catch (err) {
      console.error(`[WebRTC Debug] Error handling signal ${signal.type} from ${fromId}:`, err);
    }
  }

  private createPeerConnection(targetId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(this.iceServers);
    this.peerConnections.set(targetId, pc);

    pc.ontrack = (event) => {
      console.log(`[WebRTC Debug] Received track from ${targetId}`);
      if (this.onRemoteStreamCb && event.streams[0]) {
        this.onRemoteStreamCb(targetId, event.streams[0]);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC Debug] ICE Candidate for ${targetId}:`, event.candidate.candidate);
        this.signaling.sendSignal(targetId, this.myId, { type: 'candidate', from: this.myId, data: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC Debug] Connection state with ${targetId} changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        console.log(`[WebRTC Debug] Connected successfully with ${targetId}`);
        // No borramos aquí para permitir re-negociaciones si fueran necesarias, 
        // pero sí marcamos como estable.
        this.makingOffer.set(targetId, false);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        console.log(`[WebRTC Debug] Connection ${pc.connectionState} with ${targetId}. Cleaning up.`);
        this.closeConnection(targetId);
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(targetId, event.channel);
    };

    // Renegociación automática
    pc.onnegotiationneeded = async () => {
      try {
        console.log(`[WebRTC Debug] Negotiation needed for ${targetId}`);
        this.makingOffer.set(targetId, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.signaling.sendSignal(targetId, this.myId, { type: 'offer', from: this.myId, data: offer });
      } catch (err) {
        console.error(`[WebRTC] Negotiation failed for ${targetId}:`, err);
      } finally {
        this.makingOffer.set(targetId, false);
      }
    };

    return pc;
  }

  private closeConnection(targetId: string) {
    const pc = this.peerConnections.get(targetId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(targetId);
    }
    this.dataChannels.delete(targetId);
    this.makingOffer.delete(targetId);
    this.ignoreOffer.delete(targetId);
    this.onConnectionClosedCb?.(targetId);
    // Limpiamos señalización en Firebase para que el otro no intente reconectar
    this.signaling.clearSignaling(this.myId, targetId);
    this.signaling.clearSignaling(targetId, this.myId);
  }

  private setupDataChannel(targetId: string, channel: RTCDataChannel) {
    this.dataChannels.set(targetId, channel);
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onDataReceivedCb?.(targetId, data);
      } catch (e) {
        console.error("[WebRTC] Error parsing message:", e);
      }
    };
    channel.onopen = () => this.onConnectionOpenedCb?.(targetId);
    channel.onclose = () => this.onConnectionClosedCb?.(targetId);
  }

  async connect(targetId: string, stream?: MediaStream) {
    if (this.peerConnections.has(targetId)) {
       console.log(`[WebRTC Debug] Already connecting/connected to ${targetId}`);
       return;
    }

    console.log(`[WebRTC Debug] Initiating connection to ${targetId}`);
    const pc = this.createPeerConnection(targetId);
    
    if (stream) {
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }

    const channel = pc.createDataChannel('chat');
    this.setupDataChannel(targetId, channel);
  }

  send(targetId: string, data: any) {
    const channel = this.dataChannels.get(targetId);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(data));
    }
  }

  async addStream(targetId: string, stream: MediaStream) {
    const pc = this.peerConnections.get(targetId);
    if (pc) {
      stream.getTracks().forEach(track => {
        // Evitar duplicados
        const exists = pc.getSenders().find(s => s.track?.id === track.id);
        if (!exists) pc.addTrack(track, stream);
      });
    }
  }

  getPeerConnection(targetId: string) {
    return this.peerConnections.get(targetId);
  }

  disconnect() {
    console.log("[WebRTC Debug] Disconnecting all peers and cleaning up signaling");
    this.peerConnections.forEach((pc, targetId) => {
      this.signaling.clearSignaling(this.myId, targetId);
      this.signaling.clearSignaling(targetId, this.myId);
      pc.close();
    });
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.processedSignals.clear();
    this.makingOffer.clear();
    this.ignoreOffer.clear();
  }
}
