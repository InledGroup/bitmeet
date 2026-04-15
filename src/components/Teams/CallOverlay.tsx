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

  // Obtener medios de forma robusta
  const getMedia = async (video: boolean = true) => {
    try {
      console.log("[BitMeet] Solicitando medios...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false 
      });
      
      if (currentStreamRef.current) {
        // Si ya había algo, intentamos reemplazar tracks en lugar de cerrar todo
        const oldVideoTrack = currentStreamRef.current.getVideoTracks()[0];
        const newVideoTrack = stream.getVideoTracks()[0];
        if (oldVideoTrack && newVideoTrack) {
          transportRef.current.replaceTrack(oldVideoTrack, newVideoTrack);
        }
      }

      setLocalStream(stream);
      currentStreamRef.current = stream;
      setMediaError(null);
      return stream;
    } catch (err) {
      console.warn("[BitMeet] Fallo al obtener video, reintentando solo audio...", err);
      if (video) return getMedia(false); 
      setMediaError("No se pudo acceder a la cámara o micro.");
      return null;
    }
  };

  useEffect(() => {
    const handleCallAccepted = async (e: any) => {
      const remoteData = e.detail;
      console.log("[BitMeet] Evento call-accepted recibido para:", remoteData.peerId);
      
      // ESPERAR A QUE ESTEMOS LISTOS (STREAM + PEERJS)
      let attempts = 0;
      while (isInitializing && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }

      if (!currentStreamRef.current) {
        console.warn("[BitMeet] No hay stream local al aceptar. Reintentando obtenerlo...");
        await getMedia();
      }

      console.log("[BitMeet] Conectando con Peer:", remoteData.peerId);
      setParticipants(prev => {
        if (prev.find(p => p.peerId === remoteData.peerId)) return prev;
        return [...prev, {
          id: remoteData.peerId, peerId: remoteData.peerId,
          name: remoteData.senderUsername || "Usuario",
          isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
        }];
      });

      transportRef.current.connect(remoteData.peerId, currentStreamRef.current as any, { name: identity?.username });
    };

    async function start() {
      // 1. Obtener identidad
      const id = await bitidRef.current.getIdentity();
      if (id) {
        setIdentity(id);
        myParticipantId.current = id.publicKey;
      }

      try {
        // 2. PEDIR CÁMARA PRIMERO: No avanzamos hasta que el usuario responda al popup del navegador
        const stream = await getMedia();
        
        // 3. Inicializar PeerJS una vez tenemos la cámara lista
        const peerId = await transportRef.current.initialize(myParticipantId.current, existingPeer);
        setIsInitializing(false);

        // 4. Notificar que estamos listos para recibir la señal de 'call-accepted'
        if (onReady) onReady();
        window.addEventListener('bitmeet:call-accepted', handleCallAccepted);

        // 5. Añadirme a mí mismo
        setParticipants([{
          id: myParticipantId.current, peerId, name: id?.username || 'Yo',
          stream: stream || undefined as any,
          isLocal: true, 
          audioEnabled: stream?.getAudioTracks()[0]?.enabled ?? false, 
          videoEnabled: stream?.getVideoTracks()[0]?.enabled ?? false, 
          isScreenSharing: false
        }]);

        // 6. Configurar eventos de transporte
        transportRef.current.onRemoteStream((remotePeerId, remoteStream) => {
          console.log("[BitMeet] Stream de User recibido!");
          setParticipants(prev => prev.map(p => 
            p.peerId === remotePeerId ? { ...p, stream: remoteStream } : p
          ));
        });

        transportRef.current.onIncomingCall(async (call) => {
          console.log("[BitMeet] Respondiendo a User de:", call.peer);
          
          // ESPERAR A QUE EL STREAM ESTÉ LISTO
          let attempts = 0;
          while (!currentStreamRef.current && attempts < 50) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
          }

          if (currentStreamRef.current) {
            transportRef.current.answer(call, currentStreamRef.current as any);
          } else {
            console.error("[BitMeet] No se pudo obtener stream local a tiempo para responder.");
          }

          setParticipants(prev => {
            if (prev.find(p => p.peerId === call.peer)) return prev;
            return [...prev, {
              id: call.peer, peerId: call.peer, name: "Participante",
              isLocal: false, audioEnabled: true, videoEnabled: true, isScreenSharing: false
            }];
          });
        });

        transportRef.current.onConnectionOpened((remotePeerId) => {
          console.log("[BitMeet] Canal de datos abierto con User");
          transportRef.current.sendToPeer(remotePeerId, {
            type: 'status',
            name: id?.username || 'Usuario',
            audioEnabled: currentStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
            videoEnabled: currentStreamRef.current?.getVideoTracks()[0]?.enabled ?? false
          });
        });

        transportRef.current.onDataReceived((peerId, data) => {
          if (data.type === 'leaving') {
            setParticipants(prev => prev.filter(p => p.peerId !== peerId));
          } else if (data.type === 'status') {
            setParticipants(prev => prev.map(p => p.peerId === peerId ? {
              ...p,
              name: data.name || p.name,
              audioEnabled: data.audioEnabled ?? p.audioEnabled,
              videoEnabled: data.videoEnabled ?? p.videoEnabled,
              isScreenSharing: data.isScreenSharing ?? p.isScreenSharing
            } : p));
          }
        });

        if (isIncoming && incomingCall) {
          transportRef.current.answer(incomingCall, currentStreamRef.current as any);
        }

      } catch (err) {
        console.error("[BitMeet] Error fatal:", err);
      }
    }

    start();
    return () => {
      window.removeEventListener('bitmeet:call-accepted', handleCallAccepted);
      transportRef.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
    };
  }, [roomId]);

  const handleHangup = () => {
    transportRef.current.broadcastData({ type: 'leaving' });
    onHangup();
  };

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

        if (cameraTrack) transportRef.current.replaceTrack(cameraTrack, screenTrack);
        
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
    if (screenTrack && cameraTrack) transportRef.current.replaceTrack(screenTrack, cameraTrack);
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
            <p style={{ marginTop: '20px' }}>Configurando medios y seguridad...</p>
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
          <button className={`control-btn ${!localParticipant?.audioEnabled ? 'disabled' : ''}`} onClick={toggleAudio}>
            {localParticipant?.audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
          <button className={`control-btn ${!localParticipant?.videoEnabled ? 'disabled' : ''}`} onClick={toggleVideo}>
            {localParticipant?.videoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
          </button>
          <button className={`control-btn ${isScreenSharing ? 'active' : ''}`} onClick={toggleScreenShare}>
            {isScreenSharing ? <MonitorOff size={24} /> : <MonitorUp size={24} />}
          </button>
          <button className="control-btn danger" onClick={handleHangup}>
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </section>
  );
}
