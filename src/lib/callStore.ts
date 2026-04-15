import { atom } from 'nanostores';

export interface CallState {
  isOpen: boolean;
  roomId: string;
  isIncoming: boolean;
  incomingCall: any;
  existingPeer?: any;
  onReady?: () => void;
}

export const callStore = atom<CallState>({
  isOpen: false,
  roomId: '',
  isIncoming: false,
  incomingCall: null,
  existingPeer: null,
  onReady: undefined
});

export function startCall(roomId: string, existingPeer?: any, onReady?: () => void) {
  callStore.set({ isOpen: true, roomId, isIncoming: false, incomingCall: null, existingPeer, onReady });
}

export function receiveCall(roomId: string, call: any, existingPeer?: any) {
  callStore.set({ isOpen: true, roomId, isIncoming: true, incomingCall: call, existingPeer });
}

export function endCall() {
  callStore.set({ isOpen: false, roomId: '', isIncoming: false, incomingCall: null });
}
