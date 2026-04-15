import React, { useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Check, Users, MonitorUp, MonitorOff, MessageSquare, Settings } from 'lucide-react';
import type { Participant } from '../../core/webrtc/domain';

interface Props {
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  isScreenSharing: boolean;
  isChatOpen: boolean;
  participants: Participant[];
  roomId: string;
  localParticipant?: Participant;
}

export default function Controls({ 
  onToggleAudio, 
  onToggleVideo, 
  onToggleScreenShare,
  onToggleChat,
  onOpenSettings,
  isScreenSharing,
  isChatOpen,
  participants, 
  roomId,
  localParticipant 
}: Props) {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveMeeting = () => {
    window.location.href = '/';
  };

  return (
    <div className="controls-bar">
      <div className="participants-count hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
        <Users size={20} />
        <span>{participants.length}</span>
      </div>

      <div className="hide-mobile" style={{ width: '1px', height: '24px', backgroundColor: 'var(--card-bg)' }} />

      <button 
        className={`btn btn-icon ${!localParticipant?.audioEnabled ? 'btn-danger' : 'btn-primary'}`}
        onClick={onToggleAudio}
        title={localParticipant?.audioEnabled ? 'Mute' : 'Unmute'}
      >
        {localParticipant?.audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
      </button>

      <button 
        className={`btn btn-icon ${!localParticipant?.videoEnabled ? 'btn-danger' : 'btn-primary'}`}
        onClick={onToggleVideo}
        title={localParticipant?.videoEnabled ? 'Stop Video' : 'Start Video'}
      >
        {localParticipant?.videoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
      </button>

      <button 
        className={`btn btn-icon ${isScreenSharing ? 'btn-success' : 'btn-primary'} hide-mobile`}
        style={{ backgroundColor: isScreenSharing ? 'var(--success)' : '' }}
        onClick={onToggleScreenShare}
        title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
      >
        {isScreenSharing ? <MonitorOff size={24} /> : <MonitorUp size={24} />}
      </button>

      <button 
        className={`btn btn-icon ${isChatOpen ? 'btn-accent' : 'btn-primary'}`}
        style={{ backgroundColor: isChatOpen ? 'var(--accent)' : '' }}
        onClick={onToggleChat}
        title="Chat"
      >
        <MessageSquare size={24} />
      </button>

      <button 
        className="btn btn-icon btn-primary"
        onClick={onOpenSettings}
        title="Settings"
      >
        <Settings size={24} />
      </button>

      <button 
        className="btn btn-icon btn-danger"
        onClick={leaveMeeting}
        title="Leave Meeting"
      >
        <PhoneOff size={24} />
      </button>

      <div className="hide-mobile" style={{ width: '1px', height: '24px', backgroundColor: 'var(--card-bg)' }} />

      <button className="btn btn-primary invite-btn" onClick={copyLink}>
        {copied ? <Check size={18} /> : <Copy size={18} />}
        <span className="btn-text">{copied ? 'Copied!' : 'Invite Link'}</span>
      </button>
    </div>
  );
}
