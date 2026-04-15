import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pin, PinOff, MicOff, Monitor } from 'lucide-react';
import type { Participant } from '../../core/webrtc/domain';

// Subcomponente para detectar voz y animar el círculo
function SpeakingIndicator({ stream, isMuted, size = '3rem' }: { stream?: MediaStream, isMuted: boolean, size?: string }) {
  const [volume, setVolume] = useState(0);
  const requestRef = useRef<number>();

  useEffect(() => {
    if (!stream || isMuted) {
      setVolume(0);
      return;
    }

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalizedVolume = Math.min(average / 60, 1.5); 
        setVolume(normalizedVolume);
        requestRef.current = requestAnimationFrame(updateVolume);
      };

      requestRef.current = requestAnimationFrame(updateVolume);

      return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        source.disconnect();
        analyser.disconnect();
        audioContext.close();
      };
    } catch (e) {
      console.warn("Speaking indicator failed", e);
    }
  }, [stream, isMuted]);

  const scale = 1 + (volume > 0.1 ? volume * 0.4 : 0);
  const opacity = 0.3 + (volume > 0.1 ? volume * 0.7 : 0);

  return (
    <div 
      className="speaking-ring"
      style={{
        transform: `scale(${scale})`,
        opacity: volume > 0.1 ? opacity : 0,
        width: `calc(${size} + 20px)`,
        height: `calc(${size} + 20px)`,
      }}
    />
  );
}

interface VideoProps {
  participant: Participant;
  isFocused: boolean;
  onFocus: (id: string | null) => void;
}

function Video({ participant, isFocused, onFocus }: VideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
      // IMPORTANTE: Aseguramos que el video SIEMPRE se reproduzca (aunque esté oculto el tag) 
      // para que el audio no se detenga.
      videoRef.current.play().catch(e => console.warn("Video play interrupted", e));
    }
  }, [participant.stream]);

  const isMirrored = participant.isLocal && !participant.isScreenSharing;
  const shouldShowVideo = participant.videoEnabled || participant.isScreenSharing;
  const initialSize = isFocused ? '6rem' : '3rem';

  return (
    <div className={`video-wrapper ${participant.isLocal ? 'local' : 'remote'} ${isMirrored ? 'mirrored' : ''} ${isFocused ? 'main-video' : ''}`}>
      <div className="video-actions">
        <button 
          className="action-btn" 
          onClick={() => onFocus(isFocused ? null : participant.id)}
          title={isFocused ? "Unpin" : "Pin to main"}
        >
          {isFocused ? <PinOff size={18} /> : <Pin size={18} />}
        </button>
      </div>

      {/* 
          MANTENEMOS EL ELEMENTO VIDEO SIEMPRE EN EL DOM 
          Usamos visibilidad y opacidad en lugar de display: none para no matar el audio.
      */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        style={{ 
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: shouldShowVideo ? 1 : 0,
          position: shouldShowVideo ? 'relative' : 'absolute',
          pointerEvents: shouldShowVideo ? 'auto' : 'none',
          backgroundColor: '#000'
        }}
      />
      
      <div className="participant-name">
        {participant.name} {participant.isLocal && <span className="badge badge-me">Me</span>}
        {!participant.audioEnabled && (
          <span className="status-indicator mute-indicator">
            <MicOff size={14} />
          </span>
        )}
        {participant.isScreenSharing && (
          <span className="status-indicator screen-indicator">
            <Monitor size={14} />
          </span>
        )}
      </div>

      {!shouldShowVideo && (
        <div className="video-placeholder" style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: '#1e1e24', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 5
        }}>
          <SpeakingIndicator 
            stream={participant.stream} 
            isMuted={!participant.audioEnabled} 
            size={initialSize}
          />
          
          <div className="avatar-circle" style={{
            fontSize: initialSize,
            backgroundColor: 'var(--accent)',
            color: 'white',
            width: `calc(${initialSize} + 10px)`,
            height: `calc(${initialSize} + 10px)`,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            position: 'relative',
            zIndex: 6,
            boxShadow: '0 0 20px rgba(0,0,0,0.3)'
          }}>
            {participant.name ? participant.name[0].toUpperCase() : '?'}
          </div>
        </div>
      )}
    </div>
  );
}

export default function VideoGrid({ participants }: { participants: Participant[] }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const activeFocus = (participants.length > 1) ? focusedId : null;
  const mainParticipant = participants.find(p => p.id === activeFocus);
  const secondaryParticipants = participants.filter(p => p.id !== activeFocus);

  if (!activeFocus) {
    return (
      <div className="video-grid">
        {participants.map(p => (
          <Video 
            key={p.peerId || p.id} 
            participant={p} 
            isFocused={false} 
            onFocus={setFocusedId}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="video-grid spotlight-mode">
      <div className="main-video-area">
        {mainParticipant && (
          <Video 
            participant={mainParticipant} 
            isFocused={true} 
            onFocus={setFocusedId}
          />
        )}
      </div>
      <div className="secondary-videos">
        {secondaryParticipants.map(p => (
          <Video 
            key={p.peerId || p.id} 
            participant={p} 
            isFocused={false} 
            onFocus={setFocusedId}
          />
        ))}
      </div>
    </div>
  );
}
