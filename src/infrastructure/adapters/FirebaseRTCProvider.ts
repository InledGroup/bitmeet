import { rtdb } from '../../lib/firebase';
import { ref, onValue, push, remove, onDisconnect, update, set } from 'firebase/database';

export interface SignalMessage {
  type: 'offer' | 'answer' | 'candidate';
  from: string;
  data: any;
  timestamp: number;
}

export class FirebaseRTCProvider {
  private activeOnDisconnects: Set<string> = new Set();

  /**
   * Envía una señal a un destinatario.
   */
  async sendSignal(targetId: string, myId: string, signal: Omit<SignalMessage, 'timestamp'>) {
    // Usamos la ruta plana que sabemos que funciona con las reglas actuales
    const signalingRef = ref(rtdb, `signaling/${targetId}/${myId}`);
    
    if (!this.activeOnDisconnects.has(targetId)) {
      onDisconnect(signalingRef).remove();
      this.activeOnDisconnects.add(targetId);
    }

    if (signal.type === 'candidate') {
      const candidatesRef = ref(rtdb, `signaling/${targetId}/${myId}/candidates`);
      await push(candidatesRef, {
        data: signal.data,
        timestamp: Date.now()
      });
    } else {
      await set(signalingRef, {
        type: signal.type,
        from: myId,
        data: signal.data,
        timestamp: Date.now()
      });
    }
  }

  listenForSignals(myId: string, callback: (from: string, signal: SignalMessage) => void) {
    const mySignalingRef = ref(rtdb, `signaling/${myId}`);
    
    return onValue(mySignalingRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      Object.keys(data).forEach(fromId => {
        const signal = data[fromId];
        const now = Date.now();
        
        if (signal.type && (now - signal.timestamp < 30000)) {
          callback(fromId, {
            type: signal.type,
            from: fromId,
            data: signal.data,
            timestamp: signal.timestamp
          });
          
          if (signal.type === 'offer' || signal.type === 'answer') {
            this.clearSignaling(myId, fromId);
          }
        }
        
        if (signal.candidates) {
          Object.keys(signal.candidates).forEach(candId => {
            const cand = signal.candidates[candId];
            if (now - cand.timestamp < 30000) {
              callback(fromId, {
                type: 'candidate',
                from: fromId,
                data: cand.data,
                timestamp: cand.timestamp
              });
            }
          });
        }
      });
    });
  }

  async clearSignaling(myId: string, fromId: string) {
    const signalingRef = ref(rtdb, `signaling/${myId}/${fromId}`);
    await update(signalingRef, {
      type: null,
      data: null,
      timestamp: null,
      from: null,
    });
  }
}
