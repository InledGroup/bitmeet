import { rtdb } from '../../lib/firebase';
import { ref, set, onValue, onDisconnect } from 'firebase/database';

export type UserStatus = 'available' | 'busy' | 'in-call' | 'offline';

export interface PresenceData {
  status: UserStatus;
  lastSeen: number;
}

export class FirebasePresenceProvider {
  private myPresenceRef?: any;

  async setUserStatus(safeId: string, status: UserStatus) {
    if (!safeId) return;
    
    this.myPresenceRef = ref(rtdb, `presence/${safeId}`);

    const presenceData: PresenceData = {
      status,
      lastSeen: Date.now(),
    };

    await set(this.myPresenceRef, presenceData);
    
    // Al desconectarse (cerrar pestaña/perder red), Firebase pondrá automáticamente este estado
    onDisconnect(this.myPresenceRef).set({
      status: 'offline',
      lastSeen: Date.now()
    });
  }

  /**
   * Escucha el estado de un peer específico.
   * Devuelve una función para cancelar la suscripción.
   */
  subscribeToPresence(pubKey: string, callback: (status: UserStatus) => void) {
    const presenceRef = ref(rtdb, `presence/${pubKey}`);
    
    const unsubscribe = onValue(presenceRef, (snapshot) => {
      const data = snapshot.val() as PresenceData | null;
      if (data) {
        // Heurística de seguridad: si no hay actividad en 5 minutos, está offline
        // aunque Firebase no haya detectado la desconexión aún.
        if (Date.now() - data.lastSeen > 300000) {
          callback('offline');
        } else {
          callback(data.status);
        }
      } else {
        callback('offline');
      }
    });

    return unsubscribe;
  }
}
