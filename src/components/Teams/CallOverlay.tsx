import React, { useEffect, useRef, useState, useMemo } from 'react';
import { 
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, AlertCircle, Loader2, MonitorUp, MonitorOff,
  MessageSquare, UserPlus, Search, Send, X, Plus, Check, ChevronDown, Maximize2, Bell, Pin, PinOff
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
  const [isInitializing, setIsInitializing] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);

  // UI Panels
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [allContacts, setAllContacts] = useState<any[]>([]);
  const [invitedKeys, setInvitedKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ sender: string, content: string } | null>(null);
  const [quickReply, setQuickReply] = useState("");
  
  const transportRef = useRef(new PeerJSMediaTransport());
  const bitidRef = useRef(new BitIDService());
  const currentStreamRef = useRef<MediaStream | null>(null);
  const initializedRef = useRef(false);

  // Sync contacts
  useEffect(() => {
    if (showAddPeople && (window as any).chatRepo) {
      (window as any).chatRepo.listContacts().then((all: any) => setAllContacts(all || []));
    }
  }, [showAddPeople]);

  useEffect(() => {
    if (toast && !quickReply) {
      const timer = setTimeout(() => setToast(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [toast, quickReply]);

  // Actions
  const invitePeer = (e: any, contact: any) => {
    if (e) e.stopPropagation();
    window.dispatchEvent(new CustomEvent('bitmeet:invite-to-call', {
      detail: { publicKey: contact.publicKey, roomId, isVideo: true, invitedPeers }
    }));
    setInvitedKeys(prev => new Set([...prev, contact.publicKey]));
  };

  const sendQuickReply = (e: any) => {
    if (e) e.stopPropagation();
    if (!quickReply.trim() || !toast) return;
    window.dispatchEvent(new CustomEvent('bitmeet:send-message', { 
      detail: { chatId: roomId, content: quickReply.trim() } 
    }));
    setQuickReply("");
    setToast(null);
  };

  const filteredContacts = useMemo(() => {
    return allContacts.filter(c => {
      const isAlreadyIn = participants.some(p => p.id === c.publicKey || p.peerId === c.publicKey);
      return c.username?.toLowerCase().includes(searchQuery.toLowerCase()) && !isAlreadyIn;
    });
  }, [allContacts, searchQuery, participants]);

  const getMedia = async (video: boolean = true) => {
    try {
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
      transportRef.current.setLocalStream(stream);
      return stream;
    } catch {
      if (video) return getMedia(false);
      return null;
    }
  };

  const toggleAudio = (e: any) => {
    e.stopPropagation();
    const track = currentStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setParticipants(p => p.map(x => x.isLocal ? { ...x, audioEnabled: track.enabled } : x));
      transportRef.current.broadcastData({ type: 'status', audioEnabled: track.enabled });
    }
  };

  const toggleVideo = async (e: any) => {
    e.stopPropagation();
    const track = currentStreamRef.current?.getVideoTracks()[0];
    if (!track) {
      const s = await getMedia(true);
      if (s) {
        setParticipants(p => p.map(x => x.isLocal ? { ...x, stream: s, videoEnabled: true } : x));
        transportRef.current.broadcastData({ type: 'status', videoEnabled: true });
      }
      return;
    }
    track.enabled = !track.enabled;
    setParticipants(p => p.map(x => x.isLocal ? { ...x, videoEnabled: track.enabled } : x));
    transportRef.current.broadcastData({ type: 'status', videoEnabled: track.enabled });
  };

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const handleCallAccepted = async (e: any) => {
      const data = e.detail;
      const myId = transportRef.current.getPeerId() || transportRef.current.getPeer()?.id;
      if (!myId || data.peerId === myId) return;

      setParticipants(prev => {
        if (prev.find(p => p.peerId === data.peerId)) return prev;
        return [...prev, {
          id: data.peerId, peerId: data.peerId, name: data.senderUsername || invitedPeers?.[data.peerId]?.username || "Usuario",
          isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
        }];
      });

      if (myId < data.peerId) {
        transportRef.current.connect(data.peerId, currentStreamRef.current as any, { name: (window as any).myIdentity?.username });
      }
    };

    const handleNewMessage = (e: any) => {
      if (e.detail.chatId === roomId && e.detail.message.sender !== (window as any).myIdentity?.publicKey) {
        setToast({ sender: e.detail.message.senderName || "Usuario", content: e.detail.message.content });
      }
    };

    async function init() {
      const id = (window as any).myIdentity || await bitidRef.current.getIdentity();
      if (id) setIdentity(id);

      const stream = await getMedia();
      const peerId = await transportRef.current.initialize(id?.publicKey || 'anonymous', existingPeer);
      
      window.addEventListener('bitmeet:call-accepted', handleCallAccepted);
      window.addEventListener('bitmeet:new-message', handleNewMessage);
      if (onReady) onReady();

      setParticipants([{
        id: id?.publicKey || 'local', peerId, name: id?.username || 'Yo',
        stream: stream || undefined as any, isLocal: true,
        audioEnabled: stream?.getAudioTracks()[0]?.enabled ?? false,
        videoEnabled: stream?.getVideoTracks()[0]?.enabled ?? false,
        isScreenSharing: false
      }]);

      transportRef.current.onRemoteStream((rPeerId, rStream, rData) => {
        setParticipants(prev => {
          const name = rData?.name || invitedPeers?.[rPeerId]?.username || "Participante";
          const exists = prev.find(p => p.peerId === rPeerId);
          if (exists) return prev.map(p => p.peerId === rPeerId ? { ...p, stream: rStream, name } : p);
          return [...prev, { id: rPeerId, peerId: rPeerId, stream: rStream, name, isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false }];
        });
      });

      transportRef.current.onIncomingCall(async (call) => {
        while (!currentStreamRef.current) await new Promise(r => setTimeout(r, 100));
        transportRef.current.answer(call, currentStreamRef.current as any);
      });

      transportRef.current.onConnectionOpened((rPeerId) => {
        transportRef.current.sendToPeer(rPeerId, {
          type: 'status', name: (window as any).myIdentity?.username || 'Usuario',
          audioEnabled: currentStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
          videoEnabled: currentStreamRef.current?.getVideoTracks()[0]?.enabled ?? false
        });
      });

      transportRef.current.onDataReceived((pId, data) => {
        if (data.type === 'leaving') {
          setParticipants(prev => prev.filter(p => p.peerId !== pId));
        } else if (data.type === 'status') {
          setParticipants(prev => prev.map(p => p.peerId === pId ? { ...p, name: data.name || p.name, audioEnabled: data.audioEnabled ?? p.audioEnabled, videoEnabled: data.videoEnabled ?? p.videoEnabled } : p));
        }
      });

      transportRef.current.onConnectionClosed((pId) => {
        setParticipants(prev => prev.filter(p => p.peerId !== pId));
      });

      if (isIncoming && incomingCall) transportRef.current.answer(incomingCall, currentStreamRef.current as any);
      if (invitedPeers) {
        Object.entries(invitedPeers).forEach(([tId, info]) => {
          if (tId !== peerId && peerId < tId) {
            setParticipants(p => p.find(x => x.peerId === tId) ? p : [...p, { id: tId, peerId: tId, name: info.username || "Participante", isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false }]);
            transportRef.current.connect(tId, currentStreamRef.current as any, { name: (window as any).myIdentity?.username });
          }
        });
      }
      setIsInitializing(false);
    }

    init();
    return () => {
      transportRef.current.broadcastData({ type: 'leaving' });
      window.removeEventListener('bitmeet:call-accepted', handleCallAccepted);
      window.removeEventListener('bitmeet:new-message', handleNewMessage);
      transportRef.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      initializedRef.current = false;
    };
  }, []);

  const others = participants.filter(p => !p.isLocal);
  const activeSpeaker = others.find(p => p.stream) || others[0] || participants[0];

  if (isMinimized) {
    return (
      <div id="call-minimized" onClick={() => setIsMinimized(false)}>
        {toast && <div className="call-message-toast mini-toast"><strong>{toast.sender}:</strong> <span>{toast.content}</span></div>}
        <div className="mini-video-container">
          {activeSpeaker && <VideoGrid participants={[activeSpeaker as any]} />}
          <div className="mini-overlay">
            <button type="button" onClick={() => setIsMinimized(false)}><Maximize2 size={16} /></button>
            <span>{activeSpeaker?.name || "Llamada"}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section id="call-overlay" onClick={e => e.stopPropagation()}>
      <div className="call-canvas">
        {toast && (
          <div className="call-message-toast quick-reply-toast">
            <div className="toast-header"><Bell size={14} /><strong>{toast.sender}</strong><button className="close-toast" onClick={() => setToast(null)}><X size={14} /></button></div>
            <div className="toast-body"><p>{toast.content}</p></div>
            <div className="toast-reply-box">
              <input type="text" placeholder="Responder..." value={quickReply} onChange={e => setQuickReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendQuickReply(null)} />
              <button onClick={sendQuickReply} className="reply-send-btn"><Send size={14} /></button>
            </div>
          </div>
        )}

        {isInitializing && <div className="media-loading-overlay"><Loader2 className="animate-spin" size={48} /><p>Cargando...</p></div>}
        <div className="call-top-bar">
          <button type="button" className="control-btn small" onClick={() => setIsMinimized(true)}><ChevronDown size={24} /></button>
          <div className="call-info-badge">{participants.length} personas</div>
        </div>

        <VideoGrid participants={participants} />
        
        {showAddPeople && (
          <div className="side-panel add-people-panel">
            <div className="panel-header"><h3>Invitar</h3><button type="button" onClick={() => setShowAddPeople(false)}><X size={20} /></button></div>
            <div className="panel-search"><Search size={18} /><input type="text" placeholder="Buscar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
            <div className="panel-content contacts-list">
              {filteredContacts.map(c => (
                <div key={c.publicKey} className="contact-item">
                  <div className="contact-avatar">{c.username?.[0].toUpperCase()}</div>
                  <div className="contact-info"><span>{c.username}</span></div>
                  {invitedKeys.has(c.publicKey) ? <Check size={18} color="#34C759" /> : <button type="button" onClick={e => invitePeer(e, c)} className="invite-btn"><Plus size={18} /></button>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="call-controls">
          <button type="button" className={`control-btn ${!participants.find(p => p.isLocal)?.audioEnabled ? 'disabled' : ''}`} onClick={toggleAudio}>
            {participants.find(p => p.isLocal)?.audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
          <button type="button" className={`control-btn ${!participants.find(p => p.isLocal)?.videoEnabled ? 'disabled' : ''}`} onClick={toggleVideo}>
            {participants.find(p => p.isLocal)?.videoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
          </button>
          <div className="divider" />
          <button type="button" className="control-btn" onClick={() => { setIsMinimized(true); window.dispatchEvent(new CustomEvent('bitmeet:focus-chat', { detail: { roomId } })); }}><MessageSquare size={24} /></button>
          <button type="button" className={`control-btn ${showAddPeople ? 'active' : ''}`} onClick={() => setShowAddPeople(!showAddPeople)}><UserPlus size={24} /></button>
          <div className="divider" />
          <button type="button" className="control-btn danger" onClick={onHangup}><PhoneOff size={24} /></button>
        </div>
      </div>
    </section>
  );
}
