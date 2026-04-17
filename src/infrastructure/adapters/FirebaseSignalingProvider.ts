import { db, rtdb } from '../../lib/firebase';
import { collection, doc, setDoc, deleteDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { ref, onDisconnect, set, remove } from 'firebase/database';
import type { ISignalingProvider } from '../../core/webrtc/ports';

export class FirebaseSignalingProvider implements ISignalingProvider {
  async joinRoom(roomId: string, participantId: string, data: any): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId, 'participants', participantId);
    await setDoc(roomRef, {
      ...data,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });

    // También añadimos un nodo en RTDB para manejar el onDisconnect de forma más fiable
    // ya que Firestore no soporta onDisconnect nativo como RTDB.
    const presenceRef = ref(rtdb, `rooms/${roomId}/presence/${participantId}`);
    await set(presenceRef, true);
    onDisconnect(presenceRef).remove();
  }

  async leaveRoom(roomId: string, participantId: string): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId, 'participants', participantId);
    await deleteDoc(roomRef);

    const presenceRef = ref(rtdb, `rooms/${roomId}/presence/${participantId}`);
    await remove(presenceRef);
  }

  async updateParticipant(roomId: string, participantId: string, data: any): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId, 'participants', participantId);
    await updateDoc(roomRef, {
      ...data,
      lastSeen: serverTimestamp()
    });
  }

  onParticipantsUpdate(roomId: string, callback: (changes: any[]) => void): () => void {
    const participantsRef = collection(db, 'rooms', roomId, 'participants');
    return onSnapshot(participantsRef, (snapshot) => {
      const changes = snapshot.docChanges().map(change => ({
        type: change.type,
        id: change.doc.id,
        data: change.doc.data()
      }));
      callback(changes);
    });
  }
}
