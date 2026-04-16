import { rtdb } from './firebase';
import { ref, set, onValue, onDisconnect, serverTimestamp, get } from 'firebase/database';
import type { BitIDService } from './bitid';

export class DeviceSyncService {
  constructor(private bitid: BitIDService) {}

  async registerDevice(pubKey: string) {
    const pubKeyHash = await this.hashPubKey(pubKey);
    const deviceId = this.bitid.getDeviceId();
    const deviceRef = ref(rtdb, `users/${pubKeyHash}/devices/${deviceId}`);

    // Registrar presencia del dispositivo
    await set(deviceRef, {
      status: 'online',
      lastSeen: serverTimestamp(),
      platform: navigator.userAgent.includes('Electron') ? 'desktop' : 'web' // TODO: add more
    });

    onDisconnect(deviceRef).update({
      status: 'offline',
      lastSeen: serverTimestamp()
    });
  }

  async createPairingCode(identityData: any): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const pairingRef = ref(rtdb, `pairing/${code}`);
    
    await set(pairingRef, {
      data: identityData,
      createdAt: serverTimestamp()
    });

    // El código expira en 5 minutos
    setTimeout(() => remove(pairingRef), 300000);
    
    return code;
  }

  async claimPairingCode(code: string): Promise<any> {
    const pairingRef = ref(rtdb, `pairing/${code}`);
    const snapshot = await get(pairingRef);
    
    if (snapshot.exists()) {
      const { data } = snapshot.val();
      await remove(pairingRef); // Borrar tras usar (privacidad)
      return data;
    }
    return null;
  }

  async getActiveDevices(pubKey: string): Promise<string[]> {
    const pubKeyHash = await this.hashPubKey(pubKey);
    const devicesRef = ref(rtdb, `users/${pubKeyHash}/devices`);
    const snapshot = await get(devicesRef);
    
    if (!snapshot.exists()) return [];
    
    const data = snapshot.val();
    const now = Date.now();
    return Object.keys(data).filter(deviceId => {
      // Solo devolver dispositivos que estuvieron online en los últimos 5 minutos
      return data[deviceId].status === 'online' || (now - (data[deviceId].lastSeen || 0) < 300000);
    });
  }

  private async hashPubKey(pubKey: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(pubKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }
}
