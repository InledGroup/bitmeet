import React, { useState, useEffect } from 'react';
import { Send, X } from 'lucide-react';
import type { MeetingMessage } from '../../core/webrtc/domain';

interface Props {
  message: MeetingMessage;
  onReply: (text: string) => void;
  onClose: () => void;
}

export default function MessagePopup({ message, onReply, onClose }: Props) {
  const [replyText, setReplyText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (replyText.trim()) {
      onReply(replyText.trim());
      setReplyText('');
    }
  };

  return (
    <div className="message-popup">
      <div className="popup-header">
        <span className="sender">{message.senderName}</span>
        <button className="btn-close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="popup-body">
        <p className="message-text">{message.text}</p>
      </div>
      <form className="popup-footer" onSubmit={handleSubmit}>
        <input 
          type="text" 
          placeholder="Reply..." 
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn-send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
