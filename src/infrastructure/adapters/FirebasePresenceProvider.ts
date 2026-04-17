import { rtdb } from '../../lib/firebase';
import { ref, set, onValue, onDisconnect, serverTimestamp, off } from 'firebase/database';

export type UserStatus = 'available' | 'busy' | 'in-call' | 'offline';

export interface PresenceData {
  status: UserStatus;
  lastSeen: any;
}

export class FirebasePresenceProvider {
  private myPresenceRef?: any;
  private heartbeatInterval?: any;
  private currentStatus: UserStatus = 'available';
  private currentSafeId?: string;
  private isInitialized = false;
  private serverTimeOffset = 0;

  async setUserStatus(safeId: string, status: UserStatus) {
    this.currentSafeId = safeId;
    this.currentStatus = status;
    this.myPresenceRef = ref(rtdb, `presence/${safeId}`);

    if (!this.isInitialized) {
      this.initializeServerTimeOffset();
      this.initializeConnectionMonitoring();
      this.startHeartbeat();
      this.isInitialized = true;
    } else {
      await this.updateOnlineStatus();
    }
  }

  private initializeServerTimeOffset() {
    const offsetRef = ref(rtdb, '.info/serverTimeOffset');
    onValue(offsetRef, (snap) => {
      this.serverTimeOffset = snap.val() || 0;
      console.log(`[Presence] Server time offset: ${this.serverTimeOffset}ms`);
    });
  }

  private initializeConnectionMonitoring() {
    if (!this.currentSafeId) return;

    const connectedRef = ref(rtdb, '.info/connected');
    onValue(connectedRef, async (snap) => {
      if (snap.val() === true) {
        console.log('[Presence] Connection established with Firebase RTDB');
        
        if (this.myPresenceRef) {
          const onDisconnectRef = onDisconnect(this.myPresenceRef);
          await onDisconnectRef.set({
            status: 'offline',
            lastSeen: serverTimestamp()
          });
          
          await this.updateOnlineStatus();
        }
      } else {
        console.log('[Presence] Connection lost with Firebase RTDB');
      }
    });
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    
    // Heartbeat más frecuente (cada 30s) para asegurar que no hay caídas
    this.heartbeatInterval = setInterval(() => {
      if (this.currentSafeId && this.currentStatus !== 'offline') {
        this.updateOnlineStatus().catch(err => {
          console.warn('[Presence] Heartbeat update failed:', err);
        });
      }
    }, 30000); 
  }

  private async updateOnlineStatus() {
    if (!this.myPresenceRef || !this.currentSafeId) return;
    
    try {
      const presenceData: PresenceData = {
        status: this.currentStatus,
        lastSeen: serverTimestamp(),
      };
      await set(this.myPresenceRef, presenceData);
    } catch (err) {
      console.error('[Presence] Failed to set presence status:', err);
    }
  }

  async getRemoteStatus(safeId: string): Promise<UserStatus> {
    const presenceRef = ref(rtdb, `presence/${safeId}`);
    return new Promise((resolve) => {
      onValue(presenceRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const lastSeen = typeof data.lastSeen === 'number' ? data.lastSeen : Date.now() + this.serverTimeOffset;
          const nowServerTime = Date.now() + this.serverTimeOffset;
          
          // Heurística más relajada: 5 minutos
          if (nowServerTime - lastSeen > 300000) {
            resolve('offline');
          } else {
            resolve(data.status);
          }
        } else {
          resolve('offline');
        }
      }, { onlyOnce: true });
    });
  }

  subscribeToPresence(pubKey: string, callback: (status: UserStatus) => void) {
    const presenceRef = ref(rtdb, `presence/${pubKey}`);
    
    const onValueCallback = (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        const lastSeen = typeof data.lastSeen === 'number' ? data.lastSeen : Date.now() + this.serverTimeOffset;
        const nowServerTime = Date.now() + this.serverTimeOffset;
        
        if (nowServerTime - lastSeen > 300000) {
          callback('offline');
        } else {
          callback(data.status);
        }
      } else {
        callback('offline');
      }
    };

    onValue(presenceRef, onValueCallback);

    return () => off(presenceRef, 'value', onValueCallback);
  }

  destroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    const connectedRef = ref(rtdb, '.info/connected');
    off(connectedRef);
    const offsetRef = ref(rtdb, '.info/serverTimeOffset');
    off(offsetRef);
  }
}
