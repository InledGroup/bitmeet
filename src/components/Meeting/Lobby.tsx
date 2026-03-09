import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, User } from 'lucide-react';

interface Props {
  onJoin: (settings: { name: string; audioEnabled: boolean; videoEnabled: boolean; stream: MediaStream }) => void;
  initialName: string;
}

export default function Lobby({ onJoin, initialName }: Props) {
  const [name, setName] = useState(initialName);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    async function getMedia() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Error accessing media:", err);
        setError("Could not access camera or microphone. Please make sure to grant the necessary permissions.");
      }
    }
    getMedia();

    return () => {
      // We don't stop the tracks here to pass them to the meeting,
      // but if the component unmounts without joining, they should be cleaned up.
    };
  }, []);

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const handleJoin = () => {
    if (stream && name.trim()) {
      onJoin({ name, audioEnabled, videoEnabled, stream });
    }
  };

  return (
    <div className="lobby-container">
      <div className="lobby-card">
        <h1>Set up your entry</h1>
        <p>Make sure everything is working correctly before joining.</p>

        <div className="preview-area">
          <div className={`video-preview ${!videoEnabled ? 'hidden' : ''}`}>
            <video ref={videoRef} autoPlay playsInline muted />
            {!videoEnabled && (
              <div className="preview-placeholder">
                <div className="avatar">{name ? name[0].toUpperCase() : '?'}</div>
              </div>
            )}
          </div>
          
          <div className="preview-controls">
            <button 
              className={`btn-icon ${!audioEnabled ? 'btn-danger' : 'btn-primary'}`}
              onClick={toggleAudio}
            >
              {audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
            </button>
            <button 
              className={`btn-icon ${!videoEnabled ? 'btn-danger' : 'btn-primary'}`}
              onClick={toggleVideo}
            >
              {videoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
            </button>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="join-form">
          <div className="input-group">
            <User size={20} />
            <input 
              type="text" 
              placeholder="Your name" 
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button 
            className="btn btn-primary btn-join" 
            disabled={!stream || !name.trim()}
            onClick={handleJoin}
          >
            Join meeting
          </button>
        </div>
      </div>
    </div>
  );
}
