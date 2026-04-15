import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, AlertCircle, Loader2 } from 'lucide-react';
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
  const [identity, setIdentity] = useState<BitID | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  const transportRef = useRef(new PeerJSMediaTransport());
  const bitidRef = useRef(new BitIDService());
  const myParticipantId = useRef<string>("");
  const currentStreamRef = useRef<MediaStream | null>(null);

  // Intentar obtener medios sin bloquear la conexión
  const getMedia = async (video: boolean = true) => {
    try {
      console.log("[BitMeet] Solicitando medios (video:", video, ")...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false 
      });
      setLocalStream(stream);
      currentStreamRef.current = stream;
      setMediaError(null);
      return stream;
    } catch (err) {
      console.warn("[BitMeet] Error al obtener medios:", err);
      if (video) return getMedia(false); // Reintento solo audio
      setMediaError("No se pudo acceder a la cámara/micro. Revisa los permisos.");
      return null;
    }
  };

  useEffect(() => {
    // Manejar cuando el emisor recibe la aceptación del receptor
    const handleCallAccepted = async (e: any) => {
      const remoteData = e.detail;
      console.log("[BitMeet] Receptor aceptó. Conectando a:", remoteData.peerId);
      
      // Añadir inmediatamente al receptor a la lista
      setParticipants(prev => {
        if (prev.find(p => p.peerId === remoteData.peerId)) return prev;
        return [...prev, {
          id: remoteData.peerId,
          peerId: remoteData.peerId,
          name: remoteData.senderUsername || "Participante",
          isLocal: false,
          audioEnabled: true, videoEnabled: true, isScreenSharing: false
        }];
      });

      // Conectamos. Si no hay stream aún, conectamos sin él (se puede añadir luego)
      transportRef.current.connect(remoteData.peerId, currentStreamRef.current as any, { name: identity?.username });
    };

    async function init() {
      const id = await bitidRef.current.getIdentity();
      if (id) {
        setIdentity(id);
        myParticipantId.current = id.publicKey;
      }

      try {
        // 1. Inicializar PeerJS primero (esto no requiere cámara)
        const peerId = await transportRef.current.initialize(myParticipantId.current, existingPeer);
        setIsInitializing(false);

        // 2. Notificar que estamos listos para recibir/enviar avisos
        if (onReady) onReady();
        window.addEventListener('bitmeet:call-accepted', handleCallAccepted);

        // 3. Añadirme a mí mismo (aunque sea sin stream de momento)
        setParticipants([{
          id: myParticipantId.current,
          peerId,
          name: id?.username || 'Yo',
          isLocal: true,
          audioEnabled: true, videoEnabled: true, isScreenSharing: false
        }]);

        // 4. Configurar eventos de transporte
        transportRef.current.onRemoteStream((remotePeerId, remoteStream) => {
          console.log("[BitMeet] Stream recibido de:", remotePeerId);
          setParticipants(prev => prev.map(p => p.peerId === remotePeerId ? { ...p, stream: remoteStream } : p));
        });

        transportRef.current.onIncomingCall((call) => {
          console.log("[BitMeet] Llamada PeerJS entrante. Respondiendo...");
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
          console.log("[BitMeet] Datos P2P abiertos con:", remotePeerId);
          // Enviar mi nombre al otro lado inmediatamente
          transportRef.current.sendToPeer(remotePeerId, {
            type: 'status',
            name: id?.username || 'Usuario',
            audioEnabled: currentStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
            videoEnabled: currentStreamRef.current?.getVideoTracks()[0]?.enabled ?? false
          });
          
          setParticipants(prev => {
            if (prev.find(p => p.peerId === remotePeerId)) return prev;
            return [...prev, {
              id: remotePeerId, peerId: remotePeerId, name: "Conectado",
              isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
            }];
          });
        });

        transportRef.current.onDataReceived((peerId, data) => {
          if (data.type === 'status') {
            setParticipants(prev => prev.map(p => p.peerId === peerId ? {
              ...p,
              name: data.name || p.name,
              audioEnabled: data.audioEnabled ?? p.audioEnabled,
              videoEnabled: data.videoEnabled ?? p.videoEnabled
            } : p));
          }
        });

        transportRef.current.onConnectionClosed((peerId) => {
          setParticipants(prev => prev.filter(p => p.peerId !== peerId));
        });

        // 5. Intentar cargar cámara/micro en segundo plano sin bloquear
        getMedia().then(stream => {
          if (stream) {
            setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream } : p));
            // Si ya estamos en una llamada, PeerJS intentará re-negociar o tendremos que reconectar
            // Por simplicidad, el receptor responderá con el stream si llega a tiempo
          }
        });

        // 6. Si es una llamada entrante aceptada, responder
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

  const toggleAudio = async () => {
    if (!localStream) {
      const s = await getMedia(false);
      if (s) setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: s } : p));
      return;
    }
    const track = localStream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, audioEnabled: track.enabled } : p));
      transportRef.current.broadcastData({ type: 'status', audioEnabled: track.enabled });
    }
  };

  const toggleVideo = async () => {
    if (!localStream || !localStream.getVideoTracks()[0]) {
      const s = await getMedia(true);
      if (s) setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: s } : p));
      return;
    }
    const track = localStream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));
      transportRef.current.broadcastData({ type: 'status', videoEnabled: track.enabled });
    }
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
            <p style={{ marginTop: '20px' }}>Iniciando conexión segura...</p>
          </div>
        )}

        {mediaError && (
          <div className="media-error-overlay" style={{
            position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 200, background: 'rgba(255, 59, 48, 0.9)', color: 'white',
            padding: '12px 24px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px'
          }}>
            <AlertCircle size={20} />
            <span>{mediaError}</span>
          </div>
        )}

        <VideoGrid participants={participants} />
        
        <div className="call-controls">
          <button 
            className={`control-btn ${!localParticipant?.audioEnabled ? 'disabled' : ''}`} 
            onClick={toggleAudio}
          >
            {localParticipant?.audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
          <button 
            className={`control-btn ${!localParticipant?.videoEnabled ? 'disabled' : ''}`} 
            onClick={toggleVideo}
          >
            {localParticipant?.videoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
          </button>
          
          <button className="control-btn danger" onClick={onHangup}>
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </section>
  );
}
