
import React, { useEffect, useRef } from 'react';

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
}

function Video({ participant }: VideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
      // Forzar la reproducción por si el navegador la pausa
      videoRef.current.play().catch(e => console.warn("Video play interrupted", e));
    }
  }, [participant.stream, participant.videoEnabled, participant.isScreenSharing]);

  const isMirrored = participant.isLocal && !participant.isScreenSharing;
  // Mostrar video si está habilitado O si se está compartiendo pantalla
  const shouldShowVideo = participant.videoEnabled || participant.isScreenSharing;

  return (
    <div className={`video-wrapper ${participant.isLocal ? 'local' : 'remote'} ${isMirrored ? 'mirrored' : ''}`}>
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
          fontSize: '4rem', color: 'var(--accent)', fontWeight: 'bold', zIndex: 5
        }}>
          {participant.name[0].toUpperCase()}
        </div>
      )}
    </div>
  );
}

export default function VideoGrid({ participants }: { participants: Participant[] }) {
  return (
    <div className="video-grid">
      {participants.map(p => (
        <Video key={p.id} participant={p} />
      ))}
    </div>
  );
}
