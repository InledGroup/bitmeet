import { rtdb } from '../../lib/firebase';
import { ref, set, onValue, push, remove, onDisconnect } from 'firebase/database';

export interface SignalMessage {
  type: 'offer' | 'answer' | 'candidate';
  from: string;
  data: any;
  timestamp: number;
}

export class FirebaseRTCProvider {
  /**
   * Envía una señal (offer, answer o candidate) a un destinatario.
   */
  async sendSignal(targetId: string, myId: string, signal: Omit<SignalMessage, 'timestamp'>) {
    const signalingRef = ref(rtdb, `signaling/${targetId}/${myId}`);
    
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

    onDisconnect(signalingRef).remove();
  }

  /**
   * Escucha mensajes dirigidos a mí.
   */
  listenForSignals(myId: string, callback: (from: string, signal: SignalMessage) => void) {
    const mySignalingRef = ref(rtdb, `signaling/${myId}`);
    
    return onValue(mySignalingRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      Object.keys(data).forEach(fromId => {
        const signal = data[fromId];
        
        // Evitar procesar señales muy viejas (más de 30s)
        const now = Date.now();
        
        if (signal.type && (now - signal.timestamp < 30000)) {
          callback(fromId, {
            type: signal.type,
            from: fromId,
            data: signal.data,
            timestamp: signal.timestamp
          });
          
          // Importante: Marcar como procesado o borrar después de procesar Ofertas/Respuestas
          // para evitar bucles de estado, pero WebRTCManager ya debería manejar el estado PC.
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
    await remove(signalingRef);
  }
}
