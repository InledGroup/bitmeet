import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pin, PinOff } from 'lucide-react';

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
      videoRef.current.play().catch(e => console.warn("Video play interrupted", e));
    }
  }, [participant.stream, participant.videoEnabled, participant.isScreenSharing]);

  const isMirrored = participant.isLocal && !participant.isScreenSharing;
  const shouldShowVideo = participant.videoEnabled || participant.isScreenSharing;

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

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        style={{ 
          display: shouldShowVideo ? 'block' : 'none',
          backgroundColor: '#000'
        }}
      />
      
      <div className="participant-name">
        {participant.name} {participant.isLocal && <span className="badge badge-me">Me</span>}
        {!participant.audioEnabled && <span style={{marginLeft: '8px', color: '#ef4444'}}>🔇</span>}
        {participant.isScreenSharing && <span style={{marginLeft: '8px', color: 'var(--accent)'}}>📺</span>}
      </div>

      {!shouldShowVideo && (
        <div className="video-placeholder" style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: '#1e1e24', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isFocused ? '6rem' : '3rem', color: 'var(--accent)', fontWeight: 'bold', zIndex: 5
        }}>
          {participant.name[0].toUpperCase()}
        </div>
      )}
    </div>
  );
}

export default function VideoGrid({ participants }: { participants: Participant[] }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Si solo hay un participante (tú), no activamos modo spotlight
  const activeFocus = (participants.length > 1) ? focusedId : null;
  
  const mainParticipant = participants.find(p => p.id === activeFocus);
  const secondaryParticipants = participants.filter(p => p.id !== activeFocus);

  if (!activeFocus) {
    return (
      <div className="video-grid">
        {participants.map(p => (
          <Video 
            key={p.id} 
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
            key={p.id} 
            participant={p} 
            isFocused={false} 
            onFocus={setFocusedId}
          />
        ))}
      </div>
    </div>
  );
}
