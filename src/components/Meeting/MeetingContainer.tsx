import React, { useEffect, useRef, useState } from 'react';
import type { DataConnection } from 'peerjs';
import { db } from '../../lib/firebase';
import { encryptText, decryptText } from '../../lib/crypto';
import VideoGrid from './VideoGrid';
import Controls from './Controls';
import ChatPanel from './ChatPanel';
import SettingsModal from './SettingsModal';
import MessagePopup from './MessagePopup';
import Lobby from './Lobby';
import { nanoid } from 'nanoid';
import { BitIDService, type BitID } from '../../lib/bitid';
import { PeerJSMediaTransport } from '../../infrastructure/adapters/PeerJSMediaTransport';
import { FirebaseSignalingProvider } from '../../infrastructure/adapters/FirebaseSignalingProvider';
import type { Participant, MeetingMessage } from '../../core/webrtc/domain';

interface Props {
  roomId: string;
}

export default function MeetingContainer({ roomId }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [activePopup, setActivePopup] = useState<MeetingMessage | null>(null);
  const [identity, setIdentity] = useState<BitID | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    const saved = localStorage.getItem('bitmeet-notifications');
    return saved === null ? true : saved === 'true';
  });
  
  const transportRef = useRef(new PeerJSMediaTransport());
  const signalingRef = useRef(new FirebaseSignalingProvider());
  const bitidRef = useRef(new BitIDService());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const myParticipantId = useRef<string>("");
  const currentStreamRef = useRef<MediaStream | null>(null);
  const heartbeatRef = useRef<any>(null);

  useEffect(() => {
    async function initIdentity() {
      const id = await bitidRef.current.getIdentity();
      if (id) {
        setIdentity(id);
        myParticipantId.current = id.publicKey;
      } else {
        // Fallback if no BitID (should not happen in production)
        const fallbackId = nanoid();
        myParticipantId.current = fallbackId;
        setIdentity({ username: 'Guest', publicKey: fallbackId });
      }
    }
    initIdentity();
    audioRef.current = new Audio('/notify.mp3');
    
    // Request permission if default
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const playNotification = (msg?: MeetingMessage) => {
    if (!notificationsEnabled) return;

    if (audioRef.current) {
      audioRef.current.play().catch(e => console.warn("Error playing sound", e));
    }
    
    if (document.hidden && msg && "Notification" in window && Notification.permission === "granted") {
      const notification = new Notification(`Message from ${msg.senderName}`, {
        body: msg.text,
        icon: '/favicon.svg'
      });
      notification.onclick = () => {
        window.focus();
        setIsChatOpen(true);
      };
    }
  };

  const startMeeting = async (settings: { name: string; audioEnabled: boolean; videoEnabled: boolean; stream: MediaStream }) => {
    setLocalStream(settings.stream);
    currentStreamRef.current = settings.stream;
    
    try {
      const peerId = await transportRef.current.initialize(myParticipantId.current);
      
      await signalingRef.current.joinRoom(roomId, myParticipantId.current, {
        peerId,
        name: settings.name,
        audioEnabled: settings.audioEnabled,
        videoEnabled: settings.videoEnabled,
        isScreenSharing: false
      });

      transportRef.current.onRemoteStream((remotePeerId, stream, data) => {
        handleRemoteStream(remotePeerId, stream, data);
      });

      transportRef.current.onIncomingCall((call) => {
        const streamToAnswer = currentStreamRef.current || localStream;
        if (streamToAnswer) {
          transportRef.current.answer(call, streamToAnswer);
        }
      });

      transportRef.current.onDataReceived((remotePeerId, data) => {
        handleDataReceived(remotePeerId, data);
      });

      transportRef.current.onConnectionOpened((remotePeerId) => {
        const local = participants.find(p => p.isLocal);
        transportRef.current.sendToPeer(remotePeerId, {
          type: 'status',
          audio: settings.audioEnabled,
          video: settings.videoEnabled,
          name: settings.name,
          isScreenSharing: isScreenSharing
        });
      });

      transportRef.current.onConnectionClosed((remotePeerId) => {
        setParticipants(prev => prev.filter(p => p.peerId !== remotePeerId));
      });

      setParticipants([{
        id: myParticipantId.current,
        peerId,
        stream: settings.stream,
        name: settings.name,
        isLocal: true,
        audioEnabled: settings.audioEnabled,
        videoEnabled: settings.videoEnabled,
        isScreenSharing: false
      }]);
      
      setIsJoined(true);
      setIsReady(true);

      // Heartbeat
      heartbeatRef.current = setInterval(() => {
        signalingRef.current.updateParticipant(roomId, myParticipantId.current, {});
      }, 5000);
    } catch (err) {
      console.error("[BitMeet] Failed to start meeting:", err);
    }
  };

  useEffect(() => {
    if (!isJoined) return;

    const cleanup = () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      signalingRef.current.leaveRoom(roomId, myParticipantId.current);
      transportRef.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (currentStreamRef.current && currentStreamRef.current !== localStream) {
        currentStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };

    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, [isJoined, roomId, localStream]);

  // Discovery
  useEffect(() => {
    if (!isReady || !localStream) return;

    const unsubscribe = signalingRef.current.onParticipantsUpdate(roomId, (changes) => {
      changes.forEach((change) => {
        const data = change.data;
        const participantId = change.id;
        
        if (participantId === myParticipantId.current) {
          if (change.type === 'modified') {
             setParticipants(prev => prev.map(p => p.isLocal ? { ...p, name: data.name } : p));
          }
          return;
        }

        if (change.type === 'added') {
          updateParticipantStatus(participantId, data);
          transportRef.current.connect(data.peerId, localStream, { ...data, id: participantId });
        } else if (change.type === 'removed') {
          setParticipants(prev => prev.filter(p => p.id !== participantId));
        } else if (change.type === 'modified') {
          updateParticipantStatus(participantId, data);
        }
      });
    });

    return () => unsubscribe();
  }, [isReady, localStream, roomId]);

  const handleRemoteStream = (peerId: string, stream: MediaStream, data: any) => {
    setParticipants(prev => {
      const exists = prev.find(p => p.peerId === peerId);
      if (exists) {
        return prev.map(p => p.peerId === peerId ? { 
          ...p, 
          stream,
          id: data.id || p.id,
          name: (data.name && data.name !== `User-${peerId.slice(0,4)}`) ? data.name : p.name,
          audioEnabled: data.audioEnabled ?? data.audio ?? p.audioEnabled,
          videoEnabled: data.videoEnabled ?? data.video ?? p.videoEnabled,
          isScreenSharing: data.isScreenSharing ?? p.isScreenSharing
        } : p);
      }
      return [...prev, {
        id: data.id || peerId,
        peerId,
        stream,
        name: data.name || `User-${peerId.slice(0,4)}`,
        isLocal: false,
        audioEnabled: data.audioEnabled ?? data.audio ?? true,
        videoEnabled: data.videoEnabled ?? data.video ?? true,
        isScreenSharing: data.isScreenSharing ?? false
      }];
    });
  };

  const handleDataReceived = async (peerId: string, data: any) => {
    if (data.type === 'status') {
      setParticipants(prev => prev.map(p => p.peerId === peerId ? {
        ...p,
        audioEnabled: data.audioEnabled !== undefined ? data.audioEnabled : (data.audio !== undefined ? data.audio : p.audioEnabled),
        videoEnabled: data.videoEnabled !== undefined ? data.videoEnabled : (data.video !== undefined ? data.video : p.videoEnabled),
        name: data.name || p.name,
        isScreenSharing: data.isScreenSharing !== undefined ? data.isScreenSharing : p.isScreenSharing
      } : p));
    } else if (data.type === 'chat') {
      let decryptedText = data.message.text;
      if (data.message.encrypted) {
        try {
          decryptedText = await decryptText(data.message.text, data.message.iv, roomId);
        } catch (e) {
          decryptedText = "🔒 [Unreadable encrypted message]";
        }
      }
      
      const receivedMessage = { ...data.message, text: decryptedText };
      setMessages(prev => [...prev, receivedMessage]);
      playNotification(receivedMessage);
      
      if (!isChatOpen && receivedMessage.senderId !== myParticipantId.current) {
        setActivePopup(receivedMessage);
        setTimeout(() => setActivePopup(current => current?.id === receivedMessage.id ? null : current), 8000);
      }
    }
  };

  const updateParticipantStatus = (id: string, data: any) => {
    setParticipants(prev => {
      const exists = prev.find(p => p.id === id || p.peerId === data.peerId);
      if (!exists) return prev;
      return prev.map(p => (p.id === id || p.peerId === data.peerId) ? { 
        ...p, 
        id,
        name: data.name || p.name,
        audioEnabled: data.audioEnabled !== undefined ? data.audioEnabled : p.audioEnabled, 
        videoEnabled: data.videoEnabled !== undefined ? data.videoEnabled : p.videoEnabled, 
        isScreenSharing: data.isScreenSharing !== undefined ? data.isScreenSharing : p.isScreenSharing 
      } : p);
    });
  };

  const sendMessage = async (text: string) => {
    const newMessage: MeetingMessage = {
      id: nanoid(),
      senderName: identity?.username || 'Me',
      senderId: myParticipantId.current,
      text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, newMessage]);
    setActivePopup(null);

    try {
      const { ciphertext, iv } = await encryptText(text, roomId);
      transportRef.current.broadcastData({
        type: 'chat',
        message: { ...newMessage, text: ciphertext, iv, encrypted: true }
      });
    } catch (e) {
      console.error("Failed to encrypt message", e);
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      signalingRef.current.updateParticipant(roomId, myParticipantId.current, { audioEnabled: track.enabled });
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, audioEnabled: track.enabled } : p));
      transportRef.current.broadcastData({ type: 'status', audio: track.enabled, audioEnabled: track.enabled });
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      signalingRef.current.updateParticipant(roomId, myParticipantId.current, { videoEnabled: track.enabled });
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));
      transportRef.current.broadcastData({ type: 'status', video: track.enabled, videoEnabled: track.enabled });
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing && localStream) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = displayStream.getVideoTracks()[0];
        const audioTracks = localStream.getAudioTracks();
        const combinedStream = new MediaStream([screenTrack, ...audioTracks]);
        
        const cameraTrack = localStream.getVideoTracks()[0];
        transportRef.current.replaceTrack(cameraTrack, screenTrack);
        
        currentStreamRef.current = combinedStream;

        signalingRef.current.updateParticipant(roomId, myParticipantId.current, { isScreenSharing: true });
        setIsScreenSharing(true);
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: combinedStream, isScreenSharing: true } : p));
        
        screenTrack.onended = () => {
          stopScreenShare();
        };
      } catch (err) { 
        console.error("[BitMeet] Screen share error:", err); 
        setIsScreenSharing(false);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (!localStream) return;

    const cameraTrack = localStream.getVideoTracks()[0];
    const screenTrack = currentStreamRef.current?.getVideoTracks()[0];
    
    if (screenTrack && screenTrack.readyState !== 'ended') {
      screenTrack.stop();
    }

    if (cameraTrack && screenTrack) {
      transportRef.current.replaceTrack(screenTrack, cameraTrack);
    }

    currentStreamRef.current = localStream;
    signalingRef.current.updateParticipant(roomId, myParticipantId.current, { isScreenSharing: false });
    setIsScreenSharing(false);
    setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: localStream, isScreenSharing: false } : p));
  };

  if (!isJoined) {
    return <Lobby initialName={identity?.username || ''} onJoin={startMeeting} />;
  }

  return (
    <div className={`meeting-app ${isChatOpen ? 'chat-open' : ''}`}>
      <div className="main-content">
        <div className="e2ee-badge">🔒 E2EE</div>
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
          userName={identity?.username || ''} 
          onUpdateName={(newName) => {
             setIdentity(prev => prev ? { ...prev, username: newName } : { username: newName, publicKey: myParticipantId.current });
             signalingRef.current.updateParticipant(roomId, myParticipantId.current, { name: newName });
             transportRef.current.broadcastData({ type: 'status', name: newName });
          }} 
          onClose={() => setIsSettingsOpen(false)} 
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={(val) => {
            setNotificationsEnabled(val);
            localStorage.setItem('bitmeet-notifications', String(val));
          }}
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
