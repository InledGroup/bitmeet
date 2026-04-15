import Peer from 'peerjs';

export class P2PTransport {
  private peer: any;
  private connections: Map<string, any> = new Map();
  private peerIdToPubKey: Map<string, string> = new Map();
  private apiUrl = "https://bitid-api.inled.es";
  private onMessageCb?: (msg: any) => void;
  private onCallCb?: (call: any) => void;
  private onConnectionCb?: (peerPubKey: string) => void;
  private myPubKey: string = '';
  private presenceMap: Map<string, { status: 'online' | 'offline', lastSeen: number }> = new Map();
  private discoverySet: Set<string> = new Set();

  async initialize(pubKey: string) {
    // Usamos el hash de la pubKey como ID de PeerJS para que sea encontrable
    const peerId = await this.hashPubKey(pubKey);
    this.myPubKey = pubKey;
    this.peerIdToPubKey.set(peerId, pubKey);
    
    this.peer = new Peer(peerId, {
      debug: 2
    });

    this.peer.on('open', (id: string) => {
      console.log('Mi ID de PeerJS es:', id);
      this.startHeartbeatLoop();
    });

    this.peer.on('connection', (conn: any) => {
      this.setupConnection(conn);
    });

    this.peer.on('call', (call: any) => {
      console.log('Llamada entrante de:', call.peer);
      if (this.onCallCb) this.onCallCb(call);
    });
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
    return this.peer;
  }

  async hashPubKey(pubKey: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(pubKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  private startHeartbeatLoop() {
    setInterval(() => {
      this.connections.forEach((conn, peerId) => {
        if (conn.open) {
          conn.send({ type: '__heartbeat__', senderPubKey: this.myPubKey, timestamp: Date.now() });
        }
      });

      // Cleanup local presence: si no hemos visto a alguien en 45s, marcar offline
      const now = Date.now();
      this.presenceMap.forEach((data, pubKey) => {
        if (now - data.lastSeen > 45000) {
          this.presenceMap.set(pubKey, { status: 'offline', lastSeen: data.lastSeen });
        }
      });
    }, 15000);
  }

  private setupConnection(conn: any) {
    this.connections.set(conn.peer, conn);
    
    const notifyReady = () => {
      console.log(`Conexión P2P abierta con: ${conn.peer}`);
      const pubKey = this.peerIdToPubKey.get(conn.peer);
      if (this.onConnectionCb && pubKey) {
        this.onConnectionCb(pubKey);
      }
    };

    if (conn.open) {
      notifyReady();
    } else {
      conn.on('open', notifyReady);
    }

    conn.on('data', (data: any) => {
      if (data.senderPubKey) {
        this.peerIdToPubKey.set(conn.peer, data.senderPubKey);
        // Actualizar presencia al recibir cualquier dato
        this.presenceMap.set(data.senderPubKey, { status: 'online', lastSeen: Date.now() });
      }
      
      // Filtrar mensajes internos de control
      if (data.type === '__heartbeat__') {
        return; 
      }

      console.log('Mensaje recibido P2P:', data);
      if (this.onMessageCb) this.onMessageCb(data);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      const pubKey = this.peerIdToPubKey.get(conn.peer);
      if (pubKey) {
        this.presenceMap.set(pubKey, { status: 'offline', lastSeen: Date.now() });
        this.discoverySet.delete(pubKey);
      }
    });

    conn.on('error', () => {
      this.connections.delete(conn.peer);
      const pubKey = this.peerIdToPubKey.get(conn.peer);
      if (pubKey) {
        this.presenceMap.set(pubKey, { status: 'offline', lastSeen: Date.now() });
        this.discoverySet.delete(pubKey);
      }
    });
  }

  async connectToPeer(targetPubKey: string): Promise<boolean> {
    const targetPeerId = await this.hashPubKey(targetPubKey);
    this.peerIdToPubKey.set(targetPeerId, targetPubKey);
    const existing = this.connections.get(targetPeerId);
    if (existing && existing.open) {
      return true;
    }
    
    return new Promise((resolve) => {
      console.log(`[P2P] Connecting to peer: ${targetPeerId}`);
      const conn = this.peer.connect(targetPeerId);
      
      conn.on('open', () => {
        console.log(`[P2P] Connection opened with: ${targetPeerId}`);
        this.setupConnection(conn);
        resolve(true);
      });

      conn.on('error', (err: any) => {
        console.error(`[P2P] Connection error with ${targetPeerId}:`, err);
        resolve(false);
      });
      
      // Fallback timeout increased to 10s for slow networks
      setTimeout(() => {
        if (!this.connections.has(targetPeerId)) {
          console.warn(`[P2P] Connection timeout with: ${targetPeerId}`);
          resolve(false);
        }
      }, 10000);
    });
  }

  async sendP2PMessage(targetPubKey: string, message: any) {
    const targetPeerId = await this.hashPubKey(targetPubKey);
    const conn = this.connections.get(targetPeerId);
    if (conn && conn.open) {
      conn.send(message);
    } else {
      const connected = await this.connectToPeer(targetPubKey);
      if (connected) {
        this.connections.get(targetPeerId).send(message);
      } else {
        console.warn("Peer no conectado o offline.");
        throw new Error("offline");
      }
    }
  }

  async callPeer(targetPubKey: string, stream: MediaStream) {
    const targetPeerId = await this.hashPubKey(targetPubKey);
    return this.peer.call(targetPeerId, stream);
  }

  async isConnected(targetPubKey: string): Promise<boolean> {
    const targetPeerId = await this.hashPubKey(targetPubKey);
    const conn = this.connections.get(targetPeerId);
    return !!(conn && conn.open);
  }

  /**
   * Intenta descubrir a un peer si no estamos conectados.
   * Útil para refrescar estados online sin intervención del usuario.
   */
  async discover(pubKey: string) {
    if (this.discoverySet.has(pubKey)) return;
    if (await this.isConnected(pubKey)) return;

    this.discoverySet.add(pubKey);
    console.log(`[P2P Discovery] Saludo inicial a: ${pubKey.substring(0,8)}...`);
    
    // Intentamos conectar. Si falla, el error lo maneja connectToPeer.
    // No usamos 'await' aquí para no bloquear el hilo principal.
    this.connectToPeer(pubKey).then(success => {
      if (!success) {
        // Si falla, permitimos reintentar en 60 segundos
        setTimeout(() => this.discoverySet.delete(pubKey), 60000);
      } else {
        // Si conecta, se queda en el set hasta que se cierre la conexión
        // (lo gestionamos en setupConnection)
      }
    });
  }

  async getPresence(pubKey: string): Promise<'online' | 'offline'> {
    // 1. Si está conectado activamente, está online
    if (await this.isConnected(pubKey)) return 'online';
    
    // 2. Si lo hemos visto recientemente vía heartbeat u otros mensajes
    const cached = this.presenceMap.get(pubKey);
    if (cached && cached.status === 'online' && (Date.now() - cached.lastSeen < 45000)) {
      return 'online';
    }

    return 'offline';
  }
}
