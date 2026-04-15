import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, MonitorUp, MonitorOff, Settings } from 'lucide-react';
import { PeerJSMediaTransport } from '../../infrastructure/adapters/PeerJSMediaTransport';
import { FirebaseSignalingProvider } from '../../infrastructure/adapters/FirebaseSignalingProvider';
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
  
  const transportRef = useRef(new PeerJSMediaTransport());
  const signalingRef = useRef(new FirebaseSignalingProvider());
  const bitidRef = useRef(new BitIDService());
  const myParticipantId = useRef<string>("");
  const currentStreamRef = useRef<MediaStream | null>(null);
  const heartbeatRef = useRef<any>(null);

  const initMedia = async () => {
    try {
      setMediaError(null);
      console.log("[BitMeet] Starting media acquisition...");
      let stream: MediaStream;
      
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { 
            width: { ideal: 1280, max: 1920 }, 
            height: { ideal: 720, max: 1080 },
            facingMode: "user"
          }
        });
      } catch (e) {
        console.warn("[BitMeet] Failed with ideal constraints, trying basic video...", e);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch (e2) {
          console.warn("[BitMeet] Failed with basic video, trying audio only...", e2);
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
      }

      console.log("[BitMeet] Media stream acquired:", stream.getTracks().map(t => t.kind));
      setLocalStream(stream);
      currentStreamRef.current = stream;
      return stream;
    } catch (err: any) {
      console.error("Media acquisition failed", err);
      setMediaError(err.name === 'NotAllowedError' ? "Permission denied. Please allow camera access." : "No camera/mic found.");
      throw err;
    }
  };

  useEffect(() => {
    async function start() {
      const id = await bitidRef.current.getIdentity();
      if (id) {
        setIdentity(id);
        myParticipantId.current = id.publicKey;
      }

      try {
        const stream = await initMedia();
        const peerId = await transportRef.current.initialize(myParticipantId.current, existingPeer);
        
        await signalingRef.current.joinRoom(roomId, myParticipantId.current, {
          peerId,
          name: id?.username || 'User',
          audioEnabled: stream.getAudioTracks()[0]?.enabled ?? false,
          videoEnabled: stream.getVideoTracks()[0]?.enabled ?? false,
          isScreenSharing: false
        });

        transportRef.current.onRemoteStream((remotePeerId, remoteStream, data) => {
          setParticipants(prev => {
            const exists = prev.find(p => p.peerId === remotePeerId);
            if (exists) return prev.map(p => p.peerId === remotePeerId ? { ...p, stream: remoteStream } : p);
            return [...prev, {
              id: data.id || remotePeerId,
              peerId: remotePeerId,
              stream: remoteStream,
              name: data.name || `User-${remotePeerId.slice(0,4)}`,
              isLocal: false,
              audioEnabled: data.audioEnabled ?? true,
              videoEnabled: data.videoEnabled ?? true,
              isScreenSharing: data.isScreenSharing ?? false
            }];
          });
        });

        transportRef.current.onIncomingCall((call) => {
          const streamToAnswer = currentStreamRef.current || stream;
          transportRef.current.answer(call, streamToAnswer);
        });

        transportRef.current.onDataReceived((peerId, data) => {
          if (data.type === 'status') {
            setParticipants(prev => prev.map(p => p.peerId === peerId ? {
              ...p,
              audioEnabled: data.audioEnabled !== undefined ? data.audioEnabled : (data.audio !== undefined ? data.audio : p.audioEnabled),
              videoEnabled: data.videoEnabled !== undefined ? data.videoEnabled : (data.video !== undefined ? data.video : p.videoEnabled),
              name: data.name || p.name,
              isScreenSharing: data.isScreenSharing !== undefined ? data.isScreenSharing : p.isScreenSharing
            } : p));
          }
        });

        transportRef.current.onConnectionOpened((remotePeerId) => {
          const currentLocal = currentStreamRef.current;
          transportRef.current.sendToPeer(remotePeerId, {
            type: 'status',
            audioEnabled: currentLocal?.getAudioTracks()[0]?.enabled ?? false,
            videoEnabled: currentLocal?.getVideoTracks()[0]?.enabled ?? false,
            name: id?.username || 'User',
            isScreenSharing: isScreenSharing
          });
        });

        transportRef.current.onConnectionClosed((peerId) => {
          setParticipants(prev => prev.filter(p => p.peerId !== peerId));
        });

        setParticipants([{
          id: myParticipantId.current,
          peerId,
          stream,
          name: id?.username || 'Me',
          isLocal: true,
          audioEnabled: stream.getAudioTracks()[0]?.enabled ?? false,
          videoEnabled: stream.getVideoTracks()[0]?.enabled ?? false,
          isScreenSharing: false
        }]);

        heartbeatRef.current = setInterval(() => {
          signalingRef.current.updateParticipant(roomId, myParticipantId.current, {});
        }, 5000);

        if (onReady) onReady();

        if (isIncoming && incomingCall) {
          transportRef.current.answer(incomingCall, stream);
        } else {
          const unsubscribe = signalingRef.current.onParticipantsUpdate(roomId, (changes) => {
            changes.forEach(change => {
              if (change.id !== myParticipantId.current && change.type === 'added') {
                transportRef.current.connect(change.data.peerId, stream, { ...change.data, id: change.id });
              }
            });
          });
          return () => {
            unsubscribe();
          };
        }

      } catch (err) {
        console.error("Call initialization failed", err);
      }
    }

    const cleanup = () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      signalingRef.current.leaveRoom(roomId, myParticipantId.current);
      transportRef.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (currentStreamRef.current && currentStreamRef.current !== localStream) {
        currentStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };

    start();
    return cleanup;
  }, [roomId]);

  const toggleAudio = () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        signalingRef.current.updateParticipant(roomId, myParticipantId.current, { audioEnabled: track.enabled });
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
        signalingRef.current.updateParticipant(roomId, myParticipantId.current, { videoEnabled: track.enabled });
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, videoEnabled: track.enabled } : p));
        transportRef.current.broadcastData({ type: 'status', videoEnabled: track.enabled });
      }
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
        setIsScreenSharing(true);
        signalingRef.current.updateParticipant(roomId, myParticipantId.current, { isScreenSharing: true });
        setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: combinedStream, isScreenSharing: true } : p));
        
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
    if (screenTrack) {
      screenTrack.stop();
      transportRef.current.replaceTrack(screenTrack, cameraTrack);
    }
    currentStreamRef.current = localStream;
    setIsScreenSharing(false);
    signalingRef.current.updateParticipant(roomId, myParticipantId.current, { isScreenSharing: false });
    setParticipants(prev => prev.map(p => p.isLocal ? { ...p, stream: localStream, isScreenSharing: false } : p));
  };

  const localParticipant = participants.find(p => p.isLocal);

  return (
    <section id="call-overlay">
      <div className="call-canvas">
        {mediaError && (
          <div className="media-error-overlay" style={{
            position: 'absolute', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', color: 'white',
            textAlign: 'center', padding: '20px'
          }}>
            <p style={{ marginBottom: '20px', fontSize: '18px' }}>{mediaError}</p>
            <button className="btn btn-primary" onClick={() => initMedia()}>
              Retry Camera/Mic
            </button>
          </div>
        )}
        <VideoGrid participants={participants} />
        
        <div className="call-controls">
          <button 
            className={`control-btn ${!localParticipant?.audioEnabled ? 'disabled' : ''}`} 
            onClick={toggleAudio}
            title={localParticipant?.audioEnabled ? "Mute" : "Unmute"}
          >
            {localParticipant?.audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
          <button 
            className={`control-btn ${!localParticipant?.videoEnabled ? 'disabled' : ''}`} 
            onClick={toggleVideo}
            title={localParticipant?.videoEnabled ? "Stop Video" : "Start Video"}
          >
            {localParticipant?.videoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
          </button>
          <button 
            className={`control-btn ${isScreenSharing ? 'active' : ''}`} 
            onClick={toggleScreenShare}
            title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
          >
            {isScreenSharing ? <MonitorOff size={24} /> : <MonitorUp size={24} />}
          </button>
          <button 
            className="control-btn danger" 
            onClick={onHangup}
            title="Hang up"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </section>
  );
}
