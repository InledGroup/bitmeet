import { atom } from 'nanostores';
import { IndexedDBCallsRepository } from '../infrastructure/adapters/IndexedDBCallsRepository';

const callsRepo = new IndexedDBCallsRepository();

export interface CallState {
  isOpen: boolean;
  roomId: string;
  isIncoming: boolean;
  incomingCall: any;
  existingPeer?: any;
  onReady?: () => void;
  remotePubKey?: string;
  remoteUsername?: string;
  invitedPeers?: Record<string, { username: string, pubKey: string }>;
}

export const callStore = atom<CallState>({
  isOpen: false,
  roomId: '',
  isIncoming: false,
  incomingCall: null,
  existingPeer: null,
  onReady: undefined,
  invitedPeers: undefined
});

let currentCallStart = 0;

export async function startCall(roomId: string, existingPeer?: any, onReady?: () => void, remotePubKey?: string, remoteUsername?: string, invitedPeers?: Record<string, { username: string, pubKey: string }>) {
  currentCallStart = Date.now();
  callStore.set({ 
    isOpen: true, 
    roomId, 
    isIncoming: false, 
    incomingCall: null, 
    existingPeer, 
    onReady,
    remotePubKey,
    remoteUsername,
    invitedPeers
  });
}

export async function receiveCall(roomId: string, call: any, existingPeer?: any, remotePubKey?: string, remoteUsername?: string, invitedPeers?: Record<string, { username: string, pubKey: string }>) {
  currentCallStart = Date.now();
  callStore.set({ 
    isOpen: true, 
    roomId, 
    isIncoming: true, 
    incomingCall: call, 
    existingPeer,
    remotePubKey,
    remoteUsername,
    invitedPeers
  });
}

export async function endCall() {
  const state = callStore.get();
  if (state.isOpen && state.remotePubKey && state.remoteUsername) {
    const duration = Math.floor((Date.now() - currentCallStart) / 1000);
    await callsRepo.addCallRecord({
        id: Math.random().toString(36).substring(7),
        type: state.isIncoming ? 'incoming' : 'outgoing',
        remotePubKey: state.remotePubKey,
        remoteUsername: state.remoteUsername,
        startTime: currentCallStart,
        duration: duration,
        isVideo: true // Por defecto en BitMeet
    });
  }
  callStore.set({ isOpen: false, roomId: '', isIncoming: false, incomingCall: null });
}

export async function recordMissedCall(remotePubKey: string, remoteUsername: string) {
    await callsRepo.addCallRecord({
        id: Math.random().toString(36).substring(7),
        type: 'missed',
        remotePubKey,
        remoteUsername,
        startTime: Date.now(),
        isVideo: true
    });
}
