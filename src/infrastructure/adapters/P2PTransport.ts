import Peer from 'peerjs';

export class P2PTransport {
  private peer: any;
  private connections: Map<string, any> = new Map();
  private apiUrl = "https://bitid-api.inled.es";
  private onMessageCb?: (msg: any) => void;
  private onCallCb?: (call: any) => void;

  async initialize(pubKey: string) {
    // Usamos el hash de la pubKey como ID de PeerJS para que sea encontrable
    const peerId = await this.hashPubKey(pubKey);
    
    this.peer = new Peer(peerId, {
      debug: 2
    });

    this.peer.on('open', (id: string) => {
      console.log('Mi ID de PeerJS es:', id);
      this.registerPresence(pubKey, id);
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

  async hashPubKey(pubKey: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(pubKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  private async registerPresence(pubKey: string, peerId: string) {
    await fetch(`${this.apiUrl}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubKey, peerId, status: 'online' })
    });
  }

  private setupConnection(conn: any) {
    this.connections.set(conn.peer, conn);
    conn.on('data', (data: any) => {
      console.log('Mensaje recibido P2P:', data);
      if (this.onMessageCb) this.onMessageCb(data);
    });
  }

  async connectToPeer(targetPubKey: string): Promise<boolean> {
    const targetPeerId = await this.hashPubKey(targetPubKey);
    if (this.connections.has(targetPeerId) && this.connections.get(targetPeerId).open) {
      return true;
    }
    
    return new Promise((resolve) => {
      const conn = this.peer.connect(targetPeerId);
      conn.on('open', () => {
        this.setupConnection(conn);
        resolve(true);
      });
      conn.on('error', () => resolve(false));
      
      // Fallback timeout
      setTimeout(() => resolve(false), 5000);
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
    return conn && conn.open;
  }
}
