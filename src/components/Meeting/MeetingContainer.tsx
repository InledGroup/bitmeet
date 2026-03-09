import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { db, joinRoom, leaveRoom, updatePresence, updateName } from '../../lib/firebase';
import { onSnapshot, collection, serverTimestamp } from 'firebase/firestore';
import { encryptText, decryptText } from '../../lib/crypto';
import VideoGrid from './VideoGrid';
import Controls from './Controls';
import ChatPanel from './ChatPanel';
import SettingsModal from './SettingsModal';
import MessagePopup from './MessagePopup';
import Lobby from './Lobby';
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

interface Message {
  id: string;
  senderName: string;
  senderId: string;
  text: string;
  timestamp: number;
}

interface Props {
  roomId: string;
}

export default function MeetingContainer({ roomId }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [isPeerReady, setIsPeerReady] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activePopup, setActivePopup] = useState<Message | null>(null);
  const [userName, setUserName] = useState(() => localStorage.getItem('bitmeet-name') || '');
  
  const peerRef = useRef<Peer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const myParticipantId = useRef(nanoid());

  // Initialize sound
  useEffect(() => {
    audioRef.current = new Audio('/notify.mp3');
  }, []);

  const playNotification = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(e => console.warn("Error playing sound", e));
    }
  };
  const callsRef = useRef<Record<string, any>>({});
  const connectionsRef = useRef<Record<string, DataConnection>>({});
  const screenStreamRef = useRef<MediaStream | null>(null);

  const startMeeting = async (settings: { name: string; audioEnabled: boolean; videoEnabled: boolean; stream: MediaStream }) => {
    setLocalStream(settings.stream);
    setUserName(settings.name);
    localStorage.setItem('bitmeet-name', settings.name);
    
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (peerId) => {
      joinRoom(roomId, myParticipantId.current, peerId, settings.name, settings.audioEnabled, settings.videoEnabled);
      setIsPeerReady(true);
      setParticipants([{
        id: myParticipantId.current, peerId, stream: settings.stream, name: settings.name,
        isLocal: true, audioEnabled: settings.audioEnabled, videoEnabled: settings.videoEnabled, isScreenSharing: false
      }]);
      setIsJoined(true);

      // Heartbeat
      setInterval(() => {
        updatePresence(roomId, myParticipantId.current, {});
      }, 5000);
    });

    peer.on('connection', (conn) => {
      setupDataConnection(conn, settings.name, settings.audioEnabled, settings.videoEnabled);
    });

    peer.on('call', (call) => {
      call.answer(screenStreamRef.current || settings.stream);
      setupCallListeners(call);
    });
  };

  useEffect(() => {
    if (!isJoined) return;

    const cleanup = () => {
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
  }, [isJoined, roomId]);

  // 2. Discovery & Synchronization
  useEffect(() => {
    if (!isPeerReady || !localStream || !peerRef.current) return;

    const participantsRef = collection(db, 'rooms', roomId, 'participants');
    const unsubscribe = onSnapshot(participantsRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const participantId = change.doc.id;
        
        if (participantId === myParticipantId.current) {
          if (change.type === 'modified') {
             setParticipants(prev => prev.map(p => p.isLocal ? { ...p, name: data.name } : p));
          }
          return;
        }

        if (change.type === 'added') {
          // Primero intentamos actualizar si ya existe (por stream recibido antes de snapshot)
          updateParticipantStatus(participantId, data);
          // Luego iniciamos la llamada si es necesario
          initiateCall(data.peerId, participantId, data);
        } else if (change.type === 'removed') {
          removeParticipantById(participantId);
        } else if (change.type === 'modified') {
          updateParticipantStatus(participantId, data);
        }
      });
    });

    return () => unsubscribe();
  }, [isPeerReady, localStream, roomId]);


  const setupCallListeners = (call: any, id?: string, name?: string, initialData?: any) => {
    call.on('stream', (remoteStream: MediaStream) => {
      handleRemoteStream(call.peer, remoteStream, id, name, initialData);
    });
    
    call.on('close', () => {
      console.log('[BitMeet] Call closed by peer:', call.peer);
      removeParticipantByPeerId(call.peer);
    });

    callsRef.current[call.peer] = call;
  };

  const setupDataConnection = (conn: DataConnection, currentName?: string, currentAudio?: boolean, currentVideo?: boolean) => {
    conn.on('open', () => {
      connectionsRef.current[conn.peer] = conn;
      
      // Send our initial status to the new connection
      // Usamos los valores pasados para evitar depender de participantes que aún no se han guardado
      conn.send({ 
        type: 'status', 
        audio: currentAudio !== undefined ? currentAudio : (participants.find(p => p.isLocal)?.audioEnabled ?? true), 
        video: currentVideo !== undefined ? currentVideo : (participants.find(p => p.isLocal)?.videoEnabled ?? true),
        name: currentName || userName
      });
    });

    conn.on('data', async (data: any) => {
      if (data.type === 'status') {
        setParticipants(prev => prev.map(p => p.peerId === conn.peer ? {
          ...p,
          audioEnabled: data.audio !== undefined ? data.audio : p.audioEnabled,
          videoEnabled: data.video !== undefined ? data.video : p.videoEnabled,
          name: data.name || p.name
        } : p));
      } else if (data.type === 'chat') {
        let decryptedText = data.message.text;
        if (data.message.encrypted) {
          try {
            decryptedText = await decryptText(data.message.text, data.message.iv, roomId);
          } catch (e) {
            console.error("Failed to decrypt message", e);
            decryptedText = "🔒 [Unreadable encrypted message]";
          }
        }
        
        const receivedMessage = {
          ...data.message,
          text: decryptedText
        };

        setMessages(prev => [...prev, receivedMessage]);
        playNotification();
        
        // Show popup if chat is closed and it's not our own message
        if (!isChatOpen && receivedMessage.senderId !== myParticipantId.current) {
          setActivePopup(receivedMessage);
          // Auto-close popup after 8 seconds
          setTimeout(() => setActivePopup(current => 
            current?.id === receivedMessage.id ? null : current
          ), 8000);
        }
      }
    });

    conn.on('close', () => {
      delete connectionsRef.current[conn.peer];
    });
  };

  const initiateCall = (remotePeerId: string, id: string, data: any) => {
    if (!peerRef.current || !localStream || callsRef.current[remotePeerId]) return;

    console.log('[BitMeet] Calling peer:', remotePeerId);
    
    // Connect Data (Chat)
    const conn = peerRef.current.connect(remotePeerId);
    setupDataConnection(conn, userName, participants.find(p => p.isLocal)?.audioEnabled, participants.find(p => p.isLocal)?.videoEnabled);

    // Connect Media
    const streamToShare = screenStreamRef.current || localStream;
    const call = peerRef.current.call(remotePeerId, streamToShare);
    setupCallListeners(call, id, data.name, data);
  };

  const handleRemoteStream = (peerId: string, stream: MediaStream, id?: string, name?: string, initialData?: any) => {
    setParticipants(prev => {
      const exists = prev.find(p => p.peerId === peerId);
      if (exists) {
        return prev.map(p => p.peerId === peerId ? { 
          ...p, 
          stream,
          id: id || p.id,
          name: (name && name !== `User-${peerId.slice(0,4)}`) ? name : p.name
        } : p);
      }
      return [...prev, {
        id: id || peerId, peerId, stream, name: name || `User-${peerId.slice(0,4)}`,
        isLocal: false, audioEnabled: initialData?.audio ?? true,
        videoEnabled: initialData?.video ?? true, isScreenSharing: initialData?.isScreenSharing ?? false
      }];
    });
  };

  const removeParticipantById = (id: string) => {
    setParticipants(prev => {
      const p = prev.find(p => p.id === id);
      if (p && callsRef.current[p.peerId]) {
        callsRef.current[p.peerId].close();
        delete callsRef.current[p.peerId];
      }
      return prev.filter(p => p.id !== id);
    });
  };

  const removeParticipantByPeerId = (peerId: string) => {
    setParticipants(prev => {
      if (callsRef.current[peerId]) {
        callsRef.current[peerId].close();
        delete callsRef.current[peerId];
      }
      return prev.filter(p => p.peerId !== peerId);
    });
  };

  const updateParticipantStatus = (id: string, data: any) => {
    setParticipants(prev => {
      const exists = prev.find(p => p.id === id || p.peerId === data.peerId);
      if (!exists) return prev;
      
      return prev.map(p => (p.id === id || p.peerId === data.peerId) ? { 
        ...p, 
        id: id, // Asegurar que usamos el ID de Firestore
        name: data.name || p.name,
        audioEnabled: data.audio !== undefined ? data.audio : p.audioEnabled, 
        videoEnabled: data.video !== undefined ? data.video : p.videoEnabled, 
        isScreenSharing: data.isScreenSharing !== undefined ? data.isScreenSharing : p.isScreenSharing 
      } : p);
    });
  };

  const sendMessage = async (text: string) => {
    const localPart = participants.find(p => p.isLocal);
    const newMessage: Message = {
      id: nanoid(),
      senderName: localPart?.name || 'Me',
      senderId: myParticipantId.current,
      text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, newMessage]);
    setActivePopup(null); // Cerrar popup si respondes

    try {
      const { ciphertext, iv } = await encryptText(text, roomId);
      const payload = {
        ...newMessage,
        text: ciphertext,
        iv,
        encrypted: true
      };

      // Broadcast WebRTC
      Object.values(connectionsRef.current).forEach(conn => {
        if (conn.open) {
          conn.send({ type: 'chat', message: payload });
        }
      });
    } catch (e) {
      console.error("Failed to encrypt message", e);
    }
  };

  const updateUserName = (newName: string) => {
    setUserName(newName);
    localStorage.setItem('bitmeet-name', newName);
    updateName(roomId, myParticipantId.current, newName);
    
    // Broadcast name change via WebRTC
    Object.values(connectionsRef.current).forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'status', name: newName });
      }
    });
  };

  const toggleAudio = () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      updatePresence(roomId, myParticipantId.current, { audio: track.enabled });
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, audioEnabled: track.enabled } : p));
      
      // Broadcast WebRTC status update
      Object.values(connectionsRef.current).forEach(conn => {
        if (conn.open) {
          conn.send({ type: 'status', audio: track.enabled });
        }
      });
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      updatePresence(roomId, myParticipantId.current, { video: track.enabled });
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));

      // Broadcast WebRTC status update
      Object.values(connectionsRef.current).forEach(conn => {
        if (conn.open) {
          conn.send({ type: 'status', video: track.enabled });
        }
      });
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing && localStream) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = displayStream.getVideoTracks()[0];
        const combinedStream = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
        screenStreamRef.current = combinedStream;

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
      } catch (err) { console.error("[BitMeet] Screen share error:", err); }
    } else { stopScreenShare(); }
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

  if (!isJoined) {
    return <Lobby initialName={userName} onJoin={startMeeting} />;
  }

  return (
    <div className={`meeting-app ${isChatOpen ? 'chat-open' : ''}`}>
      <div className="main-content">
        <div className="e2ee-badge">
          🔒 E2EE
        </div>
        <VideoGrid participants={participants} />
        <Controls 
          onToggleAudio={toggleAudio} 
          onToggleVideo={toggleVideo} 
          onToggleScreenShare={toggleScreenShare} 
          onToggleChat={() => setIsChatOpen(!isChatOpen)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isScreenSharing={isScreenSharing} 
          isChatOpen={isChatOpen}
          participants={participants} 
          roomId={roomId} 
          localParticipant={participants.find(p => p.isLocal)} 
        />
      </div>

      {isChatOpen && (
        <ChatPanel 
          messages={messages} 
          onSendMessage={sendMessage} 
          onClose={() => setIsChatOpen(false)}
          localParticipantId={myParticipantId.current}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal 
          userName={userName} 
          onUpdateName={updateUserName} 
          onClose={() => setIsSettingsOpen(false)} 
        />
      )}

      {activePopup && !isChatOpen && (
        <MessagePopup 
          message={activePopup} 
          onReply={sendMessage} 
          onClose={() => setActivePopup(null)} 
        />
      )}
    </div>
  );
}


