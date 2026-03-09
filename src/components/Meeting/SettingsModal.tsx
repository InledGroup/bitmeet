import React, { useState } from 'react';
import { X, User } from 'lucide-react';

interface Props {
  userName: string;
  onUpdateName: (name: string) => void;
  onClose: () => void;
}

export default function SettingsModal({ userName, onUpdateName, onClose }: Props) {
  const [name, setName] = useState(userName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onUpdateName(name.trim());
      onClose();
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="btn-close" onClick={onClose}><X size={24} /></button>
        </div>

        <form onSubmit={handleSubmit} className="settings-form">
          <div className="form-group">
            <label htmlFor="display-name">Your Name</label>
            <div className="input-with-icon">
              <User size={20} />
              <input 
                id="display-name"
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                placeholder="Type your name..."
              />
            </div>
          </div>
          
          <button type="submit" className="btn btn-primary btn-block">
            Save changes
          </button>
        </form>
      </div>
    </div>
  );
}
