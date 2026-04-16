import { WebRTCManager } from './WebRTCManager';
import type { BitIDService } from '../../lib/bitid';
import { DeviceSyncService } from '../../lib/sync';

export class P2PTransport {
  private webrtc: WebRTCManager;
  private syncService?: DeviceSyncService;
  private bitid?: BitIDService;
  private peerIdToPubKey: Map<string, string> = new Map();
  private pubKeyToDevices: Map<string, Set<string>> = new Map();
  private apiUrl = "https://bitid-api.inled.es";
  private onMessageCb?: (msg: any) => void;
  private onCallCb?: (call: any) => void;
  private onConnectionCb?: (peerPubKey: string) => void;
  private myPubKey: string = '';
  private myPeerId: string = '';
  private presenceMap: Map<string, { status: 'online' | 'offline', lastSeen: number }> = new Map();
  private discoverySet: Set<string> = new Set();

  constructor() {
    this.webrtc = new WebRTCManager();
    this.webrtc.onDataReceived((fromId, data) => {
      this.handleIncomingData(fromId, data);
    });
    this.webrtc.onConnectionOpened((fromId) => {
      this.handleConnectionOpened(fromId);
    });
  }

  async initialize(pubKey: string, bitid: BitIDService) {
    this.bitid = bitid;
    this.syncService = new DeviceSyncService(bitid);
    this.myPubKey = pubKey;
    
    // El peerId ahora es determinista por dispositivo
    const deviceId = this.bitid.getDeviceId();
    this.myPeerId = await this.hashPeerId(pubKey, deviceId);
    
    this.peerIdToPubKey.set(this.myPeerId, pubKey);
    
    await this.webrtc.initialize(this.myPeerId);
    await this.syncService.registerDevice(pubKey);
    
    console.log('Mi ID de WebRTC (Multi-Device) es:', this.myPeerId);
    this.startHeartbeatLoop();
  }

  onMessageReceived(cb: (msg: any) => void) {
    this.onMessageCb = cb;
  }

  onIncomingCall(cb: (call: any) => void) {
    this.onCallCb = cb;
  }

  onPeerConnected(cb: (pubKey: string) => void) {
    this.onConnectionCb = cb;
  }

  getPeer() {
    return {
      id: this.myPeerId,
      on: (event: string, cb: any) => {
        if (event === 'call') this.onCallCb = cb;
      }
    };
  }

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

  private startHeartbeatLoop() {
    setInterval(() => {
      this.peerIdToPubKey.forEach((pubKey, peerId) => {
        if (peerId !== this.myPeerId) {
          try {
            this.webrtc.send(peerId, { type: '__heartbeat__', senderPubKey: this.myPubKey, timestamp: Date.now() });
          } catch (e) {}
        }
      });

      const now = Date.now();
      this.presenceMap.forEach((data, pubKey) => {
        if (now - data.lastSeen > 30000) {
          this.presenceMap.set(pubKey, { status: 'offline', lastSeen: data.lastSeen });
        }
      });
    }, 10000);
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

      this.presenceMap.set(data.senderPubKey, { status: 'online', lastSeen: Date.now() });

      // Si es otro de mis dispositivos, iniciar sincronización si es necesario
      if (data.senderPubKey === this.myPubKey && data.type === '__heartbeat__') {
         // Podríamos disparar un evento de sync aquí
         this.onMessageCb?.({ type: 'device-sync-ping', fromDeviceId: fromId });
      }
    }
    
    if (data.type === '__heartbeat__') return; 

    console.log('Mensaje recibido WebRTC:', data);
    if (this.onMessageCb) this.onMessageCb(data);
  }

  private handleConnectionOpened(fromId: string) {
    const pubKey = this.peerIdToPubKey.get(fromId);
    if (this.onConnectionCb && pubKey) {
      this.onConnectionCb(pubKey);
    }
  }

  async connectToPeer(targetPubKey: string): Promise<boolean> {
    if (!this.syncService) return false;

    const devices = await this.syncService.getActiveDevices(targetPubKey);
    if (devices.length === 0) return false;

    let atLeastOne = false;
    for (const deviceId of devices) {
      const peerId = await this.hashPeerId(targetPubKey, deviceId);
      this.peerIdToPubKey.set(peerId, targetPubKey);
      
      try {
        await this.webrtc.connect(peerId);
        atLeastOne = true;
      } catch (err) {}
    }

    return atLeastOne;
  }

  async sendP2PMessage(targetPubKey: string, message: any) {
    const devices = this.pubKeyToDevices.get(targetPubKey);
    
    if (devices && devices.size > 0) {
      let sentCount = 0;
      devices.forEach(peerId => {
        try {
          this.webrtc.send(peerId, message);
          sentCount++;
        } catch (e) {
          devices.delete(peerId);
        }
      });
      if (sentCount > 0) return;
    }

    const connected = await this.connectToPeer(targetPubKey);
    if (connected) {
      setTimeout(() => {
        const updatedDevices = this.pubKeyToDevices.get(targetPubKey);
        updatedDevices?.forEach(peerId => {
          try { this.webrtc.send(peerId, message); } catch (err) {}
        });
      }, 1000);
    } else {
      throw new Error("offline");
    }
  }

  async callPeer(targetPubKey: string, stream: MediaStream) {
    const devices = await this.syncService?.getActiveDevices(targetPubKey) || [];
    if (devices.length === 0) throw new Error("offline");

    const peerId = await this.hashPeerId(targetPubKey, devices[0]);
    await this.webrtc.connect(peerId, stream);
    
    return {
      on: (event: string, cb: any) => {
        if (event === 'stream') {
           this.webrtc.onRemoteStream((id, remoteStream) => {
             if (id === peerId) cb(remoteStream);
           });
        }
      },
      close: () => {}
    };
  }

  async isConnected(targetPubKey: string): Promise<boolean> {
    const devices = this.pubKeyToDevices.get(targetPubKey);
    if (!devices) return false;
    
    for (const peerId of devices) {
      const pc = this.webrtc.getPeerConnection(peerId);
      if (pc?.connectionState === 'connected') return true;
    }
    return false;
  }

  async discover(pubKey: string) {
    if (this.discoverySet.has(pubKey)) return;
    if (await this.isConnected(pubKey)) return;

    this.discoverySet.add(pubKey);
    this.connectToPeer(pubKey).then(success => {
      if (!success) {
        setTimeout(() => this.discoverySet.delete(pubKey), 60000);
      }
    });
  }

  async getPresence(pubKey: string): Promise<'online' | 'offline'> {
    if (await this.isConnected(pubKey)) return 'online';
    const cached = this.presenceMap.get(pubKey);
    if (cached && cached.status === 'online' && (Date.now() - cached.lastSeen < 60000)) {
      return 'online';
    }
    return 'offline';
  }
}
