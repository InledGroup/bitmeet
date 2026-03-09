import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, deleteDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

// BitMeet Firebase Configuration using Environment Variables
const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || "REPLACE_ME",
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || "bitmeet-webrtc.firebaseapp.com",
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || "bitmeet-webrtc",
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || "bitmeet-webrtc.appspot.com",
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "REPLACE_ME",
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || "REPLACE_ME"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const joinRoom = async (roomId: string, participantId: string, peerId: string, name?: string, audio: boolean = true, video: boolean = true) => {
  const roomRef = doc(db, 'rooms', roomId, 'participants', participantId);
  await setDoc(roomRef, {
    peerId,
    joinedAt: serverTimestamp(),
    audio,
    video,
    name: name || `User-${participantId.slice(0, 4)}`
  });
  return roomRef;
};

export const updateName = async (roomId: string, participantId: string, name: string) => {
  const roomRef = doc(db, 'rooms', roomId, 'participants', participantId);
  await updateDoc(roomRef, { name });
};

export const leaveRoom = async (roomId: string, participantId: string) => {
  const roomRef = doc(db, 'rooms', roomId, 'participants', participantId);
  try {
    await deleteDoc(roomRef);
  } catch (e) {
    console.error("Error leaving room", e);
  }
};

export const updatePresence = async (roomId: string, participantId: string, status: { audio?: boolean; video?: boolean; isScreenSharing?: boolean; lastSeen?: any }) => {
  const roomRef = doc(db, 'rooms', roomId, 'participants', participantId);
  await updateDoc(roomRef, {
    ...status,
    lastSeen: serverTimestamp()
  });
};
