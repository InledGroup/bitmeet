import React, { useState, useEffect, useRef } from 'react';
import { Send, X, Paperclip } from 'lucide-react';
import type { MeetingMessage } from '../../core/webrtc/domain';

interface Props {
  messages: MeetingMessage[];
  onSendMessage: (text: string) => void;
  onSendFile: (file: File) => void;
  onClose: () => void;
  localParticipantId: string;
}

export default function ChatPanel({ messages, onSendMessage, onSendFile, onClose, localParticipantId }: Props) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onSendFile(e.target.files[0]);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Chat</h3>
        <button className="btn-close" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`message ${msg.senderId === localParticipantId ? 'own' : ''}`}
          >
            <div className="message-info">
              <span className="sender">{msg.senderName}</span>
              <span className="time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            {msg.file ? (
              <div className="message-file">
                <div className="file-box">
                  <span className="file-name">{msg.file.name}</span>
                  <a href={msg.file.url} download={msg.file.name} className="download-btn">Download</a>
                </div>
              </div>
            ) : (
              <div className="message-text">{msg.text}</div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <button type="button" className="btn-attach" onClick={() => fileInputRef.current?.click()}>
          <Paperclip size={20} />
        </button>
        <input 
          type="file" 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
        />
        <input 
          type="text" 
          placeholder="Type a message..." 
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button type="submit" className="btn-send">
          <Send size={20} />
        </button>
      </form>
    </div>
  );
}
