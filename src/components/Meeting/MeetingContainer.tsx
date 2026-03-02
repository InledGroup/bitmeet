
import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { db, joinRoom, leaveRoom, updatePresence } from '../../lib/firebase';
import { onSnapshot, collection } from 'firebase/firestore';
import VideoGrid from './VideoGrid';
import Controls from './Controls';
import { nanoid } from 'nanoid';

interface Participant {
  id: string;
  peerId: string;
  stream?: MediaStream;
  name: string;
  isLocal: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing?: boolean;
}

interface Props {
  roomId: string;
}

export default function MeetingContainer({ roomId }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isPeerReady, setIsPeerReady] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  const peerRef = useRef<Peer | null>(null);
  const myParticipantId = useRef(nanoid());
  const callsRef = useRef<Record<string, any>>({});
  const screenStreamRef = useRef<MediaStream | null>(null);

  // 1. Setup Media & Peer + Cleanup
  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        if (!active) return;
        setLocalStream(stream);
        
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (peerId) => {
          if (!active) return;
          console.log('[BitMeet] Peer opened:', peerId);
          
          setParticipants([{
            id: myParticipantId.current,
            peerId,
            stream,
            name: 'Me',
            isLocal: true,
            audioEnabled: true,
            videoEnabled: true,
            isScreenSharing: false
          }]);

          joinRoom(roomId, myParticipantId.current, peerId);
          setIsPeerReady(true);
        });

        peer.on('call', (call) => {
          console.log('[BitMeet] Incoming call from:', call.peer);
          // Responder con el stream actual (sea pantalla o cámara)
          const streamToShare = screenStreamRef.current || stream;
          call.answer(streamToShare);
          
          call.on('stream', (remoteStream) => {
            console.log('[BitMeet] Received remote stream from:', call.peer);
            handleRemoteStream(call.peer, remoteStream);
          });

          callsRef.current[call.peer] = call;
        });

      } catch (err) {
        console.error('[BitMeet] Init error:', err);
      }
    }

    init();

    const cleanup = () => {
      active = false;
      leaveRoom(roomId, myParticipantId.current);
      if (peerRef.current) peerRef.current.destroy();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    };

    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, [roomId]);

  // 2. Discovery
  useEffect(() => {
    if (!isPeerReady || !localStream || !peerRef.current) return;

    const participantsRef = collection(db, 'rooms', roomId, 'participants');
    const unsubscribe = onSnapshot(participantsRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const participantId = change.doc.id;
        
        if (participantId === myParticipantId.current) return;

        if (change.type === 'added') {
          initiateCall(data.peerId, participantId, data);
        } else if (change.type === 'removed') {
          removeParticipant(participantId);
        } else if (change.type === 'modified') {
          updateParticipantStatus(participantId, data);
        }
      });
    });

    return () => unsubscribe();
  }, [isPeerReady, localStream, roomId]);

  const initiateCall = (remotePeerId: string, id: string, data: any) => {
    if (!peerRef.current || !localStream) return;
    if (callsRef.current[remotePeerId]) return;

    const streamToShare = screenStreamRef.current || localStream;
    console.log('[BitMeet] Calling:', remotePeerId);
    const call = peerRef.current.call(remotePeerId, streamToShare);
    callsRef.current[remotePeerId] = call;

    call.on('stream', (remoteStream) => {
      handleRemoteStream(remotePeerId, remoteStream, id, data.name, data);
    });
  };

  const handleRemoteStream = (peerId: string, stream: MediaStream, id?: string, name?: string, initialData?: any) => {
    setParticipants(prev => {
      const exists = prev.find(p => p.peerId === peerId);
      if (exists) return prev.map(p => p.peerId === peerId ? { ...p, stream } : p);
      
      return [...prev, {
        id: id || peerId,
        peerId,
        stream,
        name: name || `User-${peerId.slice(0,4)}`,
        isLocal: false,
        audioEnabled: initialData?.audio ?? true,
        videoEnabled: initialData?.video ?? true,
        isScreenSharing: initialData?.isScreenSharing ?? false
      }];
    });
  };

  const removeParticipant = (id: string) => {
    setParticipants(prev => {
      const p = prev.find(p => p.id === id);
      if (p && callsRef.current[p.peerId]) {
        callsRef.current[p.peerId].close();
        delete callsRef.current[p.peerId];
      }
      return prev.filter(p => p.id !== id);
    });
  };

  const updateParticipantStatus = (id: string, data: any) => {
    setParticipants(prev => prev.map(p => p.id === id ? { 
      ...p, 
      audioEnabled: data.audio, 
      videoEnabled: data.video,
      isScreenSharing: data.isScreenSharing 
    } : p));
  };

  const toggleAudio = () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      updatePresence(roomId, myParticipantId.current, { audio: track.enabled });
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, audioEnabled: track.enabled } : p));
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      updatePresence(roomId, myParticipantId.current, { video: track.enabled });
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing && localStream) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = displayStream.getVideoTracks()[0];
        
        // Crear stream combinado (Video de pantalla + Audio original de cámara)
        const combinedStream = new MediaStream([
          screenTrack,
          ...localStream.getAudioTracks()
        ]);
        
        screenStreamRef.current = combinedStream;

        // Reemplazar tracks de video en todas las llamadas activas
        Object.values(callsRef.current).forEach((call: any) => {
          if (call.peerConnection) {
            const sender = call.peerConnection.getSenders().find((s: any) => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(screenTrack);
          }
        });

        updatePresence(roomId, myParticipantId.current, { isScreenSharing: true });
        setIsScreenSharing(true);
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: combinedStream, isScreenSharing: true } : p));

        screenTrack.onended = () => stopScreenShare();
      } catch (err) {
        console.error("[BitMeet] Screen share error:", err);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    if (localStream) {
      const cameraTrack = localStream.getVideoTracks()[0];
      Object.values(callsRef.current).forEach((call: any) => {
        if (call.peerConnection) {
          const sender = call.peerConnection.getSenders().find((s: any) => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(cameraTrack);
        }
      });
      updatePresence(roomId, myParticipantId.current, { isScreenSharing: false });
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: localStream, isScreenSharing: false } : p));
    }
    setIsScreenSharing(false);
  };

  return (
    <div className="meeting-app">
      <VideoGrid participants={participants} />
      <Controls 
        onToggleAudio={toggleAudio} 
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
        isScreenSharing={isScreenSharing}
        participants={participants}
        roomId={roomId}
        localParticipant={participants.find(p => p.isLocal)}
      />
    </div>
  );
}
