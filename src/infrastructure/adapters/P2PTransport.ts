import { WebRTCManager } from './WebRTCManager';
import type { BitIDService } from '../../lib/bitid';
import { DeviceSyncService } from '../../lib/sync';
import { FirebasePresenceProvider, type UserStatus } from './FirebasePresenceProvider';

export class P2PTransport {
  private webrtc: WebRTCManager;
  private syncService?: DeviceSyncService;
  private presenceProvider: FirebasePresenceProvider;
  private bitid?: BitIDService;
  private peerIdToPubKey: Map<string, string> = new Map();
  private pubKeyToDevices: Map<string, Set<string>> = new Map();
  private onMessageCb?: (msg: any) => void;
  private onCallCb?: (call: any) => void;
  private onConnectionCb?: (peerPubKey: string) => void;
  private myPubKey: string = '';
  private myPeerId: string = '';
  private myStatus: UserStatus = 'available';
  private presenceMap: Map<string, { status: UserStatus, lastSeen: number }> = new Map();
  private discoverySet: Set<string> = new Set();
  private presenceSubscriptions: Map<string, () => void> = new Map();

  constructor() {
    // IMPORTANTE: Namespace 'p2p' para datos/sync
    this.webrtc = new WebRTCManager('p2p');
    this.presenceProvider = new FirebasePresenceProvider();
    
    this.webrtc.onDataReceived((fromId, data) => {
      this.handleIncomingData(fromId, data);
    });
    
    this.webrtc.onConnectionOpened((fromId) => {
      this.handleConnectionOpened(fromId);
    });

    this.webrtc.onConnectionClosed((fromId) => {
      this.handleConnectionClosed(fromId);
    });
  }

  async initialize(pubKey: string, bitid: BitIDService) {
    this.bitid = bitid;
    this.syncService = new DeviceSyncService(bitid);
    this.myPubKey = pubKey;
    
    const deviceId = this.bitid.getDeviceId();
    this.myPeerId = await this.hashPeerId(pubKey, deviceId);
    
    this.peerIdToPubKey.set(this.myPeerId, pubKey);
    await this.webrtc.initialize(this.myPeerId);
    
    this.syncService.registerDevice(pubKey).catch(() => {});
    
    this.hashPubKey(pubKey).then(safeId => {
      this.presenceProvider.setUserStatus(safeId, this.myStatus).catch(() => {});
    });
    
    this.startHeartbeatLoop();
    this.startSelfSyncListener();
  }

  private startSelfSyncListener() {
    if (!this.syncService || !this.myPubKey) return;
    this.syncService.listenToDevices(this.myPubKey, (deviceIds) => {
      deviceIds.forEach(async (deviceId) => {
        const peerId = await this.hashPeerId(this.myPubKey, deviceId);
        if (peerId !== this.myPeerId) {
          const pc = this.webrtc.getPeerConnection(peerId);
          if (pc?.connectionState !== 'connected') {
            this.peerIdToPubKey.set(peerId, this.myPubKey);
            this.webrtc.connect(peerId).catch(() => {});
          }
        }
      });
    });
  }

  async setStatus(status: UserStatus) {
    this.myStatus = status;
    if (this.myPubKey) {
      const safeId = await this.hashPubKey(this.myPubKey);
      await this.presenceProvider.setUserStatus(safeId, status).catch(() => {});
      this.broadcastToConnectedPeers({ type: '__status_update__', status: this.myStatus });
    }
  }

  getStatus(): UserStatus { return this.myStatus; }
  getPublicKey(): string { return this.myPubKey; }

  private broadcastToConnectedPeers(message: any) {
    this.peerIdToPubKey.forEach((_, peerId) => {
      if (peerId !== this.myPeerId) {
        try { this.webrtc.send(peerId, message); } catch (e) {}
      }
    });
  }

  private startHeartbeatLoop() {
    setInterval(() => {
      this.peerIdToPubKey.forEach((pubKey, peerId) => {
        if (peerId !== this.myPeerId) {
          try {
            this.webrtc.send(peerId, { 
              type: '__heartbeat__', 
              senderPubKey: this.myPubKey, 
              status: this.myStatus,
              timestamp: Date.now() 
            });
          } catch (e) {}
        }
      });

      const now = Date.now();
      this.presenceMap.forEach((data, pubKey) => {
        if (pubKey === this.myPubKey) return;
        if (now - data.lastSeen > 12000 && data.status !== 'offline') {
          this.presenceMap.set(pubKey, { status: 'offline', lastSeen: data.lastSeen });
          this.checkAndRetryConnection(pubKey);
        }
      });
    }, 3500);
  }

  private async checkAndRetryConnection(pubKey: string) {
    try {
      const safeId = await this.hashPubKey(pubKey);
      const status = await this.presenceProvider.getRemoteStatus(safeId);
      if (status !== 'offline') {
        this.connectToPeer(pubKey).catch(() => {});
      }
    } catch (err) {}
  }

  private handleIncomingData(fromId: string, data: any) {
    if (data.senderPubKey) {
      this.peerIdToPubKey.set(fromId, data.senderPubKey);
      let devices = this.pubKeyToDevices.get(data.senderPubKey);
      if (!devices) {
        devices = new Set();
        this.pubKeyToDevices.set(data.senderPubKey, devices);
      }
      devices.add(fromId);
      this.presenceMap.set(data.senderPubKey, { status: data.status || 'available', lastSeen: Date.now() });
      if (data.type === '__heartbeat__' || data.type === '__status_update__') return;
    }
    if (this.onMessageCb) this.onMessageCb(data);
  }

  private handleConnectionOpened(fromId: string) {
    const pubKey = this.peerIdToPubKey.get(fromId);
    if (this.onConnectionCb && pubKey) this.onConnectionCb(pubKey);
  }

  private handleConnectionClosed(fromId: string) {
    const pubKey = this.peerIdToPubKey.get(fromId);
    if (pubKey) {
      const devices = this.pubKeyToDevices.get(pubKey);
      devices?.delete(fromId);
      if (!devices || devices.size === 0) {
        const current = this.presenceMap.get(pubKey);
        if (current) this.presenceMap.set(pubKey, { ...current, status: 'offline' });
      }
    }
  }

  async connectToPeer(targetPubKey: string): Promise<boolean> {
    if (!this.syncService) return false;
    const devices = await this.syncService.getActiveDevices(targetPubKey);
    if (devices.length === 0) return false;

    let atLeastOne = false;
    for (const deviceId of devices) {
      const peerId = await this.hashPeerId(targetPubKey, deviceId);
      if (peerId === this.myPeerId) continue;
      this.peerIdToPubKey.set(peerId, targetPubKey);
      
      let devs = this.pubKeyToDevices.get(targetPubKey);
      if (!devs) { devs = new Set(); this.pubKeyToDevices.set(targetPubKey, devs); }
      devs.add(peerId);
      
      try {
        await this.webrtc.connect(peerId);
        atLeastOne = true;
      } catch (err) {}
    }
    this.trackPresenceGlobally(targetPubKey);
    return atLeastOne;
  }

  private async trackPresenceGlobally(pubKey: string) {
    if (this.presenceSubscriptions.has(pubKey)) return;
    try {
      const safeId = await this.hashPubKey(pubKey);
      const unsub = this.presenceProvider.subscribeToPresence(safeId, (status) => {
        const current = this.presenceMap.get(pubKey);
        if (status !== 'offline' && (!current || current.status === 'offline')) {
          this.connectToPeer(pubKey);
        }
        this.presenceMap.set(pubKey, { status, lastSeen: current?.lastSeen || Date.now() });
      });
      this.presenceSubscriptions.set(pubKey, unsub);
    } catch (err) {}
  }

  async sendP2PMessage(targetPubKey: string, message: any) {
    if (targetPubKey === this.myPubKey) {
      if (this.onMessageCb) this.onMessageCb({ ...message, senderPubKey: this.myPubKey, senderUsername: (window as any).myIdentity?.username || "Yo" });
    }

    const devices = this.pubKeyToDevices.get(targetPubKey);
    if (devices && devices.size > 0) {
      let sentCount = 0;
      devices.forEach(peerId => {
        try { this.webrtc.send(peerId, message); sentCount++; } catch (e) { devices.delete(peerId); }
      });
      if (sentCount > 0) return;
    }

    const connected = await this.connectToPeer(targetPubKey);
    if (connected) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        const updated = this.pubKeyToDevices.get(targetPubKey);
        if (updated && updated.size > 0) {
          let sent = false;
          updated.forEach(pid => { try { this.webrtc.send(pid, message); sent = true; } catch (e) {} });
          if (sent) return;
        }
      }
    }
    throw new Error("offline");
  }

  async isConnected(targetPubKey: string): Promise<boolean> {
    const devices = this.pubKeyToDevices.get(targetPubKey);
    if (!devices || devices.size === 0) return false;
    for (const peerId of devices) {
      const pc = this.webrtc.getPeerConnection(peerId);
      if (pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected')) return true;
    }
    return false;
  }

  async discover(pubKey: string) {
    if (this.discoverySet.has(pubKey)) return;
    if (await this.isConnected(pubKey)) return;
    this.discoverySet.add(pubKey);
    this.connectToPeer(pubKey).then(success => { if (!success) setTimeout(() => this.discoverySet.delete(pubKey), 60000); });
  }

  async getPresence(pubKey: string): Promise<UserStatus> {
    this.trackPresenceGlobally(pubKey);
    const cached = this.presenceMap.get(pubKey);
    return cached ? cached.status : 'offline';
  }

  onMessageReceived(cb: (m: any) => void) { this.onMessageCb = cb; }
  onIncomingCall(cb: (c: any) => void) { this.onCallCb = cb; }
  onPeerConnected(cb: (p: string) => void) { this.onConnectionCb = cb; }
  getPeer() { return { id: this.myPeerId, on: (e: string, cb: any) => { if (e === 'call') this.onCallCb = cb; } }; }

  async hashPubKey(pubKey: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(pubKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  private async hashPeerId(pubKey: string, deviceId: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(pubKey + deviceId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }
}
