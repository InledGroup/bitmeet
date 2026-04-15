import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, AlertCircle, Loader2, MonitorUp, MonitorOff } from 'lucide-react';
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
}

export default function CallOverlay({ roomId, onHangup, isIncoming, incomingCall, existingPeer, onReady }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [identity, setIdentity] = useState<BitID | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  const transportRef = useRef(new PeerJSMediaTransport());
  const bitidRef = useRef(new BitIDService());
  const myParticipantId = useRef<string>("");
  const currentStreamRef = useRef<MediaStream | null>(null);

  const getMedia = async (video: boolean = true) => {
    try {
      console.log("[BitMeet] Solicitando medios (video:", video, ")...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false 
      });
      
      // Si ya teníamos un stream, detenemos los tracks viejos
      if (currentStreamRef.current) {
        currentStreamRef.current.getTracks().forEach(t => t.stop());
      }

      setLocalStream(stream);
      currentStreamRef.current = stream;
      setMediaError(null);
      return stream;
    } catch (err) {
      console.warn("[BitMeet] Error al obtener medios:", err);
      if (video) return getMedia(false); 
      setMediaError("No se pudo acceder a la cámara/micro.");
      return null;
    }
  };

  useEffect(() => {
    const handleCallAccepted = async (e: any) => {
      const remoteData = e.detail;
      console.log("[BitMeet] Receptor aceptó. Conectando a:", remoteData.peerId);
      
      setParticipants(prev => {
        if (prev.find(p => p.peerId === remoteData.peerId)) return prev;
        return [...prev, {
          id: remoteData.peerId, peerId: remoteData.peerId,
          name: remoteData.senderUsername || "Participante",
          isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
        }];
      });

      transportRef.current.connect(remoteData.peerId, currentStreamRef.current as any, { name: identity?.username });
    };

    async function init() {
      const id = await bitidRef.current.getIdentity();
      if (id) {
        setIdentity(id);
        myParticipantId.current = id.publicKey;
      }

      try {
        const peerId = await transportRef.current.initialize(myParticipantId.current, existingPeer);
        setIsInitializing(false);

        if (onReady) onReady();
        window.addEventListener('bitmeet:call-accepted', handleCallAccepted);

        setParticipants([{
          id: myParticipantId.current, peerId, name: id?.username || 'Yo',
          isLocal: true, audioEnabled: true, videoEnabled: true, isScreenSharing: false
        }]);

        transportRef.current.onRemoteStream((remotePeerId, remoteStream) => {
          setParticipants(prev => prev.map(p => p.peerId === remotePeerId ? { ...p, stream: remoteStream } : p));
        });

        transportRef.current.onIncomingCall((call) => {
          transportRef.current.answer(call, currentStreamRef.current as any);
          setParticipants(prev => {
            if (prev.find(p => p.peerId === call.peer)) return prev;
            return [...prev, {
              id: call.peer, peerId: call.peer, name: "Participante",
              isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
            }];
          });
        });

        transportRef.current.onConnectionOpened((remotePeerId) => {
          transportRef.current.sendToPeer(remotePeerId, {
            type: 'status',
            name: id?.username || 'Usuario',
            audioEnabled: currentStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
            videoEnabled: currentStreamRef.current?.getVideoTracks()[0]?.enabled ?? false
          });
        });

        transportRef.current.onDataReceived((peerId, data) => {
          if (data.type === 'status') {
            setParticipants(prev => prev.map(p => p.peerId === peerId ? {
              ...p,
              name: data.name || p.name,
              audioEnabled: data.audioEnabled ?? p.audioEnabled,
              videoEnabled: data.videoEnabled ?? p.videoEnabled,
              isScreenSharing: data.isScreenSharing ?? p.isScreenSharing
            } : p));
          }
        });

        transportRef.current.onConnectionClosed((peerId) => {
          setParticipants(prev => prev.filter(p => p.peerId !== peerId));
        });

        const stream = await getMedia();
        if (stream) {
          setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream, videoEnabled: !!stream.getVideoTracks()[0] } : p));
        }

        if (isIncoming && incomingCall) {
          transportRef.current.answer(incomingCall, currentStreamRef.current as any);
        }

      } catch (err) {
        console.error("[BitMeet] Error en inicialización:", err);
      }
    }

    init();
    return () => {
      window.removeEventListener('bitmeet:call-accepted', handleCallAccepted);
      transportRef.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
    };
  }, [roomId]);

  const toggleAudio = () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, audioEnabled: track.enabled } : p));
        transportRef.current.broadcastData({ type: 'status', audioEnabled: track.enabled });
      }
    }
  };

  const toggleVideo = async () => {
    if (!localStream || !localStream.getVideoTracks()[0]) {
      const s = await getMedia(true);
      if (s) {
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: s, videoEnabled: true } : p));
        // Forzamos re-conexión o actualización si Peter ya estaba ahí
        transportRef.current.broadcastData({ type: 'status', videoEnabled: true });
      }
      return;
    }
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));
    transportRef.current.broadcastData({ type: 'status', videoEnabled: track.enabled });
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing && localStream) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = displayStream.getVideoTracks()[0];
        const cameraTrack = localStream.getVideoTracks()[0];

        if (cameraTrack) {
          transportRef.current.replaceTrack(cameraTrack, screenTrack);
        }
        
        const combined = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
        currentStreamRef.current = combined;
        setIsScreenSharing(true);
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: combined, isScreenSharing: true } : p));
        transportRef.current.broadcastData({ type: 'status', isScreenSharing: true });

        screenTrack.onended = () => stopScreenShare();
      } catch (err) { console.error(err); }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (!localStream) return;
    const cameraTrack = localStream.getVideoTracks()[0];
    const screenTrack = currentStreamRef.current?.getVideoTracks()[0];
    if (screenTrack && cameraTrack) {
      transportRef.current.replaceTrack(screenTrack, cameraTrack);
    }
    currentStreamRef.current = localStream;
    setIsScreenSharing(false);
    setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: localStream, isScreenSharing: false } : p));
    transportRef.current.broadcastData({ type: 'status', isScreenSharing: false });
  };

  const localParticipant = participants.find(p => p.isLocal);

  return (
    <section id="call-overlay">
      <div className="call-canvas">
        {isInitializing && (
          <div className="media-loading-overlay" style={{
            position: 'absolute', inset: 0, zIndex: 110, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.9)', color: 'white'
          }}>
            <Loader2 className="animate-spin" size={48} />
            <p style={{ marginTop: '20px' }}>Iniciando...</p>
          </div>
        )}

        <VideoGrid participants={participants} />
        
        <div className="call-controls">
          <button className={`control-btn ${!localParticipant?.audioEnabled ? 'disabled' : ''}`} onClick={toggleAudio}>
            {localParticipant?.audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
          <button className={`control-btn ${!localParticipant?.videoEnabled ? 'disabled' : ''}`} onClick={toggleVideo}>
            {localParticipant?.videoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
          </button>
          <button className={`control-btn ${isScreenSharing ? 'active' : ''}`} onClick={toggleScreenShare}>
            {isScreenSharing ? <MonitorOff size={24} /> : <MonitorUp size={24} />}
          </button>
          <button className="control-btn danger" onClick={onHangup}>
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </section>
  );
}
