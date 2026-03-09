import React, { useState, useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';

interface Message {
  id: string;
  senderName: string;
  senderId: string;
  text: string;
  timestamp: number;
}

interface Props {
  messages: Message[];
  onSendMessage: (text: string) => void;
  onClose: () => void;
  localParticipantId: string;
}

export default function ChatPanel({ messages, onSendMessage, onClose, localParticipantId }: Props) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
            <div className="message-text">{msg.text}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <input 
          type="text" 
          placeholder="Escribe un mensaje..." 
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
