import React from 'react';
import { useStore } from '@nanostores/react';
import { callStore, endCall } from '../../lib/callStore';
import CallOverlay from './CallOverlay';

export default function CallWrapper() {
  const $call = useStore(callStore);

  if (!$call.isOpen) return null;

  return (
    <CallOverlay 
      roomId={$call.roomId}
      isIncoming={$call.isIncoming}
      incomingCall={$call.incomingCall}
      existingPeer={$call.existingPeer}
      onReady={$call.onReady}
      invitedPeers={$call.invitedPeers}
      onHangup={endCall}
    />
  );
}
