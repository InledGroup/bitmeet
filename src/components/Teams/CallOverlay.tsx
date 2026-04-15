import React, { useEffect, useRef, useState, useMemo } from 'react';
import { 
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, AlertCircle, Loader2, MonitorUp, MonitorOff,
  MessageSquare, UserPlus, Search, Send, X, Plus, Check
} from 'lucide-react';
import { PeerJSMediaTransport } from '../../infrastructure/adapters/PeerJSMediaTransport';
import { BitIDService, type BitID } from '../../lib/bitid';
import VideoGrid from '../Meeting/VideoGrid';
import type { Participant } from '../../core/webrtc/domain';

interface Props {
  roomId: string;
  onHangup: () => void;
  isIncoming?: boolean;
  incomingCall?: any;
  existingPeer?: any;
  onReady?: () => void;
  invitedPeers?: Record<string, { username: string, pubKey: string }>;
}

export default function CallOverlay({ roomId, onHangup, isIncoming, incomingCall, existingPeer, onReady, invitedPeers }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [identity, setIdentity] = useState<BitID | null>((window as any).myIdentity || null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // States for side panels
  const [showChat, setShowChat] = useState(false);
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [allContacts, setAllContacts] = useState<any[]>([]);
  const [invitedKeys, setInvitedKeys] = useState<Set<string>>(new Set());
  
  const transportRef = useRef(new PeerJSMediaTransport());
  const bitidRef = useRef(new BitIDService());
  const myParticipantId = useRef<string>((window as any).myIdentity?.publicKey || "");
  const currentStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // 1. DATA FETCHING (CHAT & CONTACTS)
  useEffect(() => {
    if (showChat && (window as any).chatRepo) {
      (window as any).chatRepo.getMessages(roomId).then((msgs: any) => setChatMessages(msgs || []));
    }
  }, [showChat]);

  useEffect(() => {
    if (showAddPeople && (window as any).chatRepo) {
      (window as any).chatRepo.listContacts().then((all: any) => setAllContacts(all || []));
    }
  }, [showAddPeople]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showChat]);

  // 2. ACTIONS
  const sendMessage = () => {
    if (!newMessage.trim()) return;
    window.dispatchEvent(new CustomEvent('bitmeet:send-message', { 
      detail: { chatId: roomId, content: newMessage.trim() } 
    }));
    setNewMessage("");
  };

  const invitePeer = (contact: any) => {
    window.dispatchEvent(new CustomEvent('bitmeet:invite-to-call', {
      detail: { 
        publicKey: contact.publicKey, 
        roomId, 
        isVideo: !!currentStreamRef.current?.getVideoTracks().length,
        invitedPeers 
      }
    }));
    setInvitedKeys(prev => new Set([...prev, contact.publicKey]));
  };

  const filteredContacts = useMemo(() => {
    return allContacts.filter(c => {
      const matchesSearch = c.username?.toLowerCase().includes(searchQuery.toLowerCase());
      const isAlreadyIn = participants.some(p => p.id === c.publicKey);
      return matchesSearch && !isAlreadyIn;
    });
  }, [allContacts, searchQuery, participants]);

  // 3. MEDIA & CONTROLS
  const getMedia = async (video: boolean = true) => {
    try {
      console.log("[BitMeet] Medios solicitados...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false 
      });
      
      if (currentStreamRef.current) {
        const oldTrack = currentStreamRef.current.getVideoTracks()[0];
        const newTrack = stream.getVideoTracks()[0];
        if (oldTrack && newTrack) transportRef.current.replaceTrack(oldTrack, newTrack);
      }

      setLocalStream(stream);
      currentStreamRef.current = stream;
      setMediaError(null);
      return stream;
    } catch (err: any) {
      if (video) return getMedia(false);
      setMediaError("Error de cámara/micro");
      return null;
    }
  };

  const toggleAudio = () => {
    const stream = currentStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, audioEnabled: track.enabled } : p));
      transportRef.current.broadcastData({ type: 'status', audioEnabled: track.enabled });
    }
  };

  const toggleVideo = async () => {
    const stream = currentStreamRef.current;
    if (!stream || !stream.getVideoTracks()[0]) {
      const s = await getMedia(true);
      if (s) {
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: s, videoEnabled: true } : p));
        transportRef.current.broadcastData({ type: 'status', videoEnabled: true });
      }
      return;
    }
    const track = stream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));
    transportRef.current.broadcastData({ type: 'status', videoEnabled: track.enabled });
  };

  // 4. MAIN EFFECT (P2P TRANSPORT)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const handleCallAccepted = async (e: any) => {
      const data = e.detail;
      const myId = transportRef.current.getPeerId() || transportRef.current.getPeer()?.id;
      if (!myId) return;

      setParticipants(prev => {
        if (prev.find(p => p.peerId === data.peerId)) return prev;
        const name = invitedPeers?.[data.peerId]?.username || data.senderUsername || "Usuario";
        return [...prev, {
          id: data.peerId, peerId: data.peerId, name,
          isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
        }];
      });

      if (myId < data.peerId) {
        transportRef.current.connect(data.peerId, currentStreamRef.current as any, { name: identity?.username });
      }
    };

    const handleNewMessage = (e: any) => {
      if (e.detail.chatId === roomId) setChatMessages(prev => [...prev, e.detail.message]);
    };

    async function init() {
      let id = (window as any).myIdentity || await bitidRef.current.getIdentity();
      if (id) { setIdentity(id); myParticipantId.current = id.publicKey; }

      const stream = await getMedia();
      const peerId = await transportRef.current.initialize(myParticipantId.current || 'anonymous', existingPeer);
      
      window.addEventListener('bitmeet:call-accepted', handleCallAccepted);
      window.addEventListener('bitmeet:new-message', handleNewMessage);
      if (onReady) onReady();

      setParticipants([{
        id: myParticipantId.current || 'local', peerId, name: id?.username || 'Yo',
        stream: stream || undefined as any, isLocal: true,
        audioEnabled: stream?.getAudioTracks()[0]?.enabled ?? false,
        videoEnabled: stream?.getVideoTracks()[0]?.enabled ?? false,
        isScreenSharing: false
      }]);

      transportRef.current.onRemoteStream((rPeerId: string, rStream: any, rData: any) => {
        setParticipants(prev => {
          const existing = prev.find(p => p.peerId === rPeerId);
          if (existing) return prev.map(p => p.peerId === rPeerId ? { ...p, stream: rStream } : p);
          return [...prev, {
            id: rPeerId, peerId: rPeerId, stream: rStream, isLocal: false,
            name: rData?.name || invitedPeers?.[rPeerId]?.username || "Participante",
            audioEnabled: true, videoEnabled: true, isScreenSharing: false
          }];
        });
      });

      transportRef.current.onIncomingCall(async (call: any) => {
        while (!currentStreamRef.current) await new Promise(r => setTimeout(r, 100));
        transportRef.current.answer(call, currentStreamRef.current as any);
        setParticipants(prev => {
          if (prev.find(p => p.peerId === call.peer)) return prev;
          return [...prev, {
            id: call.peer, peerId: call.peer, isLocal: false,
            name: invitedPeers?.[call.peer]?.username || "Participante",
            audioEnabled: true, videoEnabled: true, isScreenSharing: false
          }];
        });
      });

      transportRef.current.onConnectionOpened((rPeerId: string) => {
        transportRef.current.sendToPeer(rPeerId, {
          type: 'status', name: id?.username || 'Usuario',
          audioEnabled: currentStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
          videoEnabled: currentStreamRef.current?.getVideoTracks()[0]?.enabled ?? false
        });
      });

      transportRef.current.onDataReceived((pId: string, data: any) => {
        if (data.type === 'leaving') setParticipants(prev => prev.filter(p => p.peerId !== pId));
        else if (data.type === 'status') {
          setParticipants(prev => prev.map(p => p.peerId === pId ? {
            ...p, name: data.name || p.name,
            audioEnabled: data.audioEnabled ?? p.audioEnabled,
            videoEnabled: data.videoEnabled ?? p.videoEnabled,
            isScreenSharing: data.isScreenSharing ?? p.isScreenSharing
          } : p));
        }
      });

      if (isIncoming && incomingCall) transportRef.current.answer(incomingCall, currentStreamRef.current as any);

      if (invitedPeers) {
        Object.entries(invitedPeers).forEach(([tPeerId, info]) => {
          if (tPeerId !== peerId && peerId < tPeerId) {
            setParticipants(prev => {
              if (prev.find(p => p.peerId === tPeerId)) return prev;
              return [...prev, {
                id: tPeerId, peerId: tPeerId, name: info.username || "Participante",
                isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
              }];
            });
            transportRef.current.connect(tPeerId, currentStreamRef.current as any, { name: id?.username });
          }
        });
      }

      setIsInitializing(false);
    }

    init();

    return () => {
      window.removeEventListener('bitmeet:call-accepted', handleCallAccepted);
      window.removeEventListener('bitmeet:new-message', handleNewMessage);
      transportRef.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      initializedRef.current = false;
    };
  }, []); // EFECTO ÚNICO AL MONTAR

  const localParticipant = participants.find(p => p.isLocal);

  return (
    <section id="call-overlay" className={(showChat || showAddPeople) ? 'panel-open' : ''}>
      <div className="call-canvas">
        {isInitializing && (
          <div className="media-loading-overlay" style={{
            position: 'absolute', inset: 0, zIndex: 110, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.95)', color: 'white'
          }}>
            <Loader2 className="animate-spin" size={48} />
            <p style={{ marginTop: '20px' }}>Iniciando llamada segura...</p>
          </div>
        )}

        {mediaError && (
          <div className="media-error-overlay" style={{
            position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 200, background: '#FF3B30', color: 'white',
            padding: '12px 24px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px'
          }}>
            <AlertCircle size={20} />
            <span>{mediaError}</span>
          </div>
        )}

        <VideoGrid participants={participants} />
        
        <div className="call-controls">
          <button type="button" className={`control-btn ${!localParticipant?.audioEnabled ? 'disabled' : ''}`} onClick={toggleAudio}>
            {localParticipant?.audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
          <button type="button" className={`control-btn ${!localParticipant?.videoEnabled ? 'disabled' : ''}`} onClick={toggleVideo}>
            {localParticipant?.videoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
          </button>
          
          <div className="divider"></div>
          
          <button type="button" className={`control-btn ${showChat ? 'active' : ''}`} onClick={() => { setShowChat(!showChat); setShowAddPeople(false); }}>
            <MessageSquare size={24} />
            {chatMessages.length > 0 && !showChat && <span className="badge-count"></span>}
          </button>
          
          <button type="button" className={`control-btn ${showAddPeople ? 'active' : ''}`} onClick={() => { setShowAddPeople(!showAddPeople); setShowChat(false); }}>
            <UserPlus size={24} />
          </button>

          <div className="divider"></div>

          <button type="button" className="control-btn danger" onClick={onHangup}>
            <PhoneOff size={24} />
          </button>
        </div>

        {/* PANELS */}
        {showChat && (
          <div className="side-panel chat-panel" style={{ display: 'flex' }}>
            <div className="panel-header">
              <h3>Chat de Grupo</h3>
              <button onClick={() => setShowChat(false)}><X size={20} /></button>
            </div>
            <div className="panel-content messages-list">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`message-item ${msg.sender === myParticipantId.current ? 'own' : ''}`}>
                  <span className="sender">{msg.senderName}</span>
                  <p>{msg.content}</p>
                  <span className="time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="panel-footer">
              <input type="text" placeholder="Escribe un mensaje..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} />
              <button onClick={sendMessage} className="send-btn"><Send size={18} /></button>
            </div>
          </div>
        )}

        {showAddPeople && (
          <div className="side-panel add-people-panel" style={{ display: 'flex' }}>
             <div className="panel-header">
              <h3>Invitar</h3>
              <button onClick={() => setShowAddPeople(false)}><X size={20} /></button>
            </div>
            <div className="panel-search">
              <Search size={18} />
              <input type="text" placeholder="Buscar..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div className="panel-content contacts-list">
              {filteredContacts.map((contact: any, i: number) => (
                <div key={contact.publicKey || i} className="contact-item">
                  <div className="contact-avatar">{contact.username ? contact.username[0].toUpperCase() : '?'}</div>
                  <div className="contact-info"><span className="username">{contact.username}</span></div>
                  {invitedKeys.has(contact.publicKey) ? (
                    <span className="invited-label"><Check size={16} /></span>
                  ) : (
                    <button onClick={() => invitePeer(contact)} className="invite-btn"><Plus size={18} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
