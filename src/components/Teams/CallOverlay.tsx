import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Loader2, AlertCircle } from 'lucide-react';
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
  const [isLoadingMedia, setIsLoadingMedia] = useState(true);
  
  const transportRef = useRef(new PeerJSMediaTransport());
  const bitidRef = useRef(new BitIDService());
  const myParticipantId = useRef<string>("");
  const currentStreamRef = useRef<MediaStream | null>(null);

  const initMedia = async () => {
    setIsLoadingMedia(true);
    setMediaError(null);
    console.log("[BitMeet] Solicitando permisos de cámara y micro...");
    
    try {
      const constraints = [
        { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
        { audio: true, video: true },
        { audio: true, video: false }
      ];

      for (const constraint of constraints) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraint);
          console.log("[BitMeet] Permisos concedidos:", constraint);
          setLocalStream(stream);
          currentStreamRef.current = stream;
          setIsLoadingMedia(false);
          return stream;
        } catch (e) {
          console.warn(`[BitMeet] Falló constraint:`, constraint, e);
        }
      }
    } catch (err) {
      console.error("[BitMeet] Error fatal al pedir medios:", err);
    }

    setMediaError("No se pudo acceder a la cámara o micro. Comprueba los permisos de tu navegador.");
    setIsLoadingMedia(false);
    return null;
  };

  useEffect(() => {
    const handleCallAccepted = (e: any) => {
      const remoteData = e.detail;
      console.log("[BitMeet] Aceptación recibida. Conectando a:", remoteData.peerId);
      
      // Aseguramos que el participante aparezca ya en la lista con su nombre
      setParticipants(prev => {
        if (prev.find(p => p.peerId === remoteData.peerId)) return prev;
        return [...prev, {
          id: remoteData.peerId,
          peerId: remoteData.peerId,
          name: remoteData.senderUsername || "Participante",
          isLocal: false,
          audioEnabled: true,
          videoEnabled: true,
          isScreenSharing: false
        }];
      });

      const s = currentStreamRef.current;
      transportRef.current.connect(remoteData.peerId, s || undefined as any, { name: identity?.username });
    };

    async function start() {
      const id = await bitidRef.current.getIdentity();
      if (id) {
        setIdentity(id);
        myParticipantId.current = id.publicKey;
      }

      try {
        // 1. Medios primero para que salte el popup de permisos YA
        const stream = await initMedia();

        // 2. PeerJS
        const peerId = await transportRef.current.initialize(myParticipantId.current, existingPeer);
        
        // 3. Notificar al sistema
        if (onReady) onReady();
        window.addEventListener('bitmeet:call-accepted', handleCallAccepted);

        // 4. Añadirme a mí mismo
        setParticipants([{
          id: myParticipantId.current,
          peerId,
          stream: stream || undefined as any,
          name: id?.username || 'Yo',
          isLocal: true,
          audioEnabled: stream?.getAudioTracks()[0]?.enabled ?? false,
          videoEnabled: stream?.getVideoTracks()[0]?.enabled ?? false,
          isScreenSharing: false
        }]);

        // 5. Configurar callbacks de transporte
        transportRef.current.onRemoteStream((remotePeerId, remoteStream) => {
          console.log("[BitMeet] Stream remoto recibido de:", remotePeerId);
          setParticipants(prev => prev.map(p => 
            p.peerId === remotePeerId ? { ...p, stream: remoteStream } : p
          ));
        });

        transportRef.current.onIncomingCall((call) => {
          console.log("[BitMeet] Respondiendo llamada entrante de PeerJS...");
          transportRef.current.answer(call, currentStreamRef.current || undefined as any);
          
          // Aseguramos que aparezca en la lista si no estaba
          setParticipants(prev => {
            if (prev.find(p => p.peerId === call.peer)) return prev;
            return [...prev, {
              id: call.peer,
              peerId: call.peer,
              name: "Participante",
              isLocal: false,
              audioEnabled: true,
              videoEnabled: true,
              isScreenSharing: false
            }];
          });
        });

        transportRef.current.onDataReceived((peerId, data) => {
          if (data.type === 'status') {
            setParticipants(prev => prev.map(p => p.peerId === peerId ? {
              ...p,
              audioEnabled: data.audioEnabled ?? p.audioEnabled,
              videoEnabled: data.videoEnabled ?? p.videoEnabled,
              name: data.name || p.name
            } : p));
          }
        });

        transportRef.current.onConnectionOpened((remotePeerId) => {
          console.log("[BitMeet] Conexión de datos abierta con:", remotePeerId);
          transportRef.current.sendToPeer(remotePeerId, {
            type: 'status',
            audioEnabled: currentStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
            videoEnabled: currentStreamRef.current?.getVideoTracks()[0]?.enabled ?? false,
            name: id?.username || 'Usuario'
          });
          
          // Añadir a la lista aunque no haya video aún
          setParticipants(prev => {
            if (prev.find(p => p.peerId === remotePeerId)) return prev;
            return [...prev, {
              id: remotePeerId,
              peerId: remotePeerId,
              name: "Conectando...",
              isLocal: false,
              audioEnabled: true,
              videoEnabled: true,
              isScreenSharing: false
            }];
          });
        });

        transportRef.current.onConnectionClosed((peerId) => {
          setParticipants(prev => prev.filter(p => p.peerId !== peerId));
        });

        if (isIncoming && incomingCall) {
          transportRef.current.answer(incomingCall, stream || undefined as any);
        }

      } catch (err) {
        console.error("Error en start:", err);
      }
    }

    start();
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

  const toggleVideo = () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));
        transportRef.current.broadcastData({ type: 'status', videoEnabled: track.enabled });
      }
    }
  };

  const localParticipant = participants.find(p => p.isLocal);

  return (
    <section id="call-overlay">
      <div className="call-canvas">
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
