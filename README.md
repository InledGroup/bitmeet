
# 🚀 BitMeet: Decentralized Serverless Video Conferencing

BitMeet is a professional-grade, peer-to-peer video conferencing application built with **Astro**, **React**, and **WebRTC**. It uses **Firebase Firestore** as a signaling channel for participant discovery, ensuring a truly serverless experience for the developer and high privacy for the users.

## ✨ Features

- **Full Mesh WebRTC**: Direct P2P connections between all participants.
- **No Server Infrastructure**: Uses Firebase for discovery and PeerJS for signaling.
- **Dynamic Layout**: Smart video grid that adapts to the number of participants.
- **Screen Sharing**: High-quality display capture and sharing.
- **Media Controls**: Professional mute/unmute and camera toggle.
- **Infinite Rooms**: Create unique meetings with a single click.
- **SSR Enabled**: Built with Astro SSR for dynamic room routing.

## 🛠️ Tech Stack

- **Frontend**: Astro 5.0, React 19.
- **Communication**: WebRTC (PeerJS).
- **Signaling/Discovery**: Firebase Firestore.
- **Icons**: Lucide React.
- **Styling**: Pure CSS (Modern Variables, Flexbox, Grid).

## 🚀 Getting Started

### 1. Clone and Install
```bash
npm install
```

### 2. Configure Firebase
Create a project in [Firebase Console](https://console.firebase.google.com/) and enable **Cloud Firestore**.

Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Required variables:
- `PUBLIC_FIREBASE_API_KEY`
- `PUBLIC_FIREBASE_PROJECT_ID`
- ... (see `.env.example`)

### 3. Firestore Rules
Ensure your Firestore rules allow reading/writing to the `rooms` collection:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId}/participants/{participantId} {
      allow read, write: if true; // In production, add proper validation
    }
  }
}
```

### 4. Run Development Server
```bash
npm run dev
```

### 5. Build for Production
```bash
npm run build
node ./dist/server/entry.mjs
```

## 🔐 Privacy & Security
BitMeet uses WebRTC to encrypt media streams end-to-end. Firebase only stores temporary metadata (PeerIDs and presence status) required for participants to find each other. No audio or video data ever touches a server.

---
**Built with ❤️ for decentralized communication.**
