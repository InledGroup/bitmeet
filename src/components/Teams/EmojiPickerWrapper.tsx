import React from 'react';
import { EmojiPicker } from 'frimousse';

interface Props {
  onSelect: (emoji: string) => void;
}

export default function EmojiPickerWrapper() {
  return (
    <div className="frimousse-picker-container">
      <style>{`
        .frimousse-picker-container {
          display: flex;
          flex-direction: column;
          height: 420px;
          background: transparent;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .emoji-search-input {
          width: calc(100% - 24px) !important;
          margin: 12px !important;
          padding: 10px 14px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(0,0,0,0.1) !important;
          background: rgba(0,0,0,0.03) !important;
          font-size: 14px !important;
          outline: none !important;
          box-sizing: border-box !important;
        }
        .emoji-viewport {
          flex: 1 !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          padding: 0 12px 12px !important;
          max-height: 350px !important;
          display: block !important;
        }
        [data-frimousse-viewport] {
          overflow-y: auto !important;
          height: 350px !important;
        }
        /* Scrollbar elegante */
        .emoji-viewport::-webkit-scrollbar { width: 6px; }
        .emoji-viewport::-webkit-scrollbar-track { background: transparent; }
        .emoji-viewport::-webkit-scrollbar-thumb { background: #d1d1d6; border-radius: 10px; }

        .emoji-list {
          display: grid !important;
          grid-template-columns: repeat(8, 1fr) !important;
          gap: 4px !important;
          padding: 4px !important;
        }
        [data-frimousse-list-category] {
          grid-column: 1 / -1;
          font-size: 13px;
          font-weight: 600;
          color: #1d1d1f;
          margin: 16px 0 8px 4px;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
        }
        /* Limpiando botones de emoji nativos */
        [data-frimousse-list-emoji], 
        .emoji-list button,
        .emoji-list [role="button"] {
          all: unset !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 26px !important;
          width: 36px !important;
          height: 36px !important;
          cursor: pointer !important;
          border-radius: 8px !important;
          transition: all 0.2s cubic-bezier(0.2, 0, 0, 1) !important;
          background: transparent !important;
          border: none !important;
          -webkit-tap-highlight-color: transparent !important;
        }
        [data-frimousse-list-emoji]:hover,
        .emoji-list button:hover,
        .emoji-list [role="button"]:hover {
          background: rgba(0, 0, 0, 0.05) !important;
          transform: scale(1.2) !important;
        }
        [data-frimousse-list-emoji]:active,
        .emoji-list [role="button"]:active {
          transform: scale(0.9) !important;
          background: rgba(0, 0, 0, 0.1) !important;
        }
      `}</style>
      <EmojiPicker.Root onEmojiSelect={(emoji: any) => {
        const event = new CustomEvent('emoji-selected', { detail: emoji.emoji });
        window.dispatchEvent(event);
      }}>
        <EmojiPicker.Search placeholder="Buscar emoji..." className="emoji-search-input" />
        <EmojiPicker.Viewport className="emoji-viewport">
          <EmojiPicker.List className="emoji-list" />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>
    </div>
  );
}
