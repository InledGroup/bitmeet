# BitMeet 🚀
> Professional-grade, Decentralized & Serverless Video Conferencing.

BitMeet is a state-of-the-art P2P video conferencing platform built on the edge. By leveraging **Astro**, **WebRTC**, and **Firebase**, it delivers a seamless, high-performance experience with zero server overhead and maximum privacy.

![BitMeet Showcase](https://raw.githubusercontent.com/InledGroup/bitmeet/main/public/banner.png) *(Note: Placeholder for actual banner)*

---

## ✨ Features

- **🛡️ True Privacy**: Peer-to-Peer (P2P) architecture. Your data never touches our servers.
- **⚡ Edge Optimized**: Built with Astro 6 and deployed on Cloudflare Pages for ultra-low latency.
- **📱 Responsive Design**: Smart video grid that adapts to any screen size and participant count.
- **🎥 Professional Tools**: High-definition screen sharing, media controls, and instant room creation.
- **🛰️ Serverless Discovery**: Intelligent participant discovery via Firebase Firestore.
- **🔒 E2EE Ready**: Encrypted media streams via WebRTC native protocols.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | [Astro 6](https://astro.build/) (SSR) |
| **UI Library** | [React 19](https://react.dev/) |
| **Communication** | WebRTC via [PeerJS](https://peerjs.com/) |
| **Discovery** | [Firebase Firestore](https://firebase.google.com/) |
| **Deployment** | [Cloudflare Pages](https://pages.cloudflare.com/) |
| **Icons** | [Lucide React](https://lucide.dev/) |

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone git@github.com:InledGroup/bitmeet.git
cd bitmeet
npm install
```

### 2. Environment Setup
Copy the example environment file and fill in your Firebase credentials:
```bash
cp .env.example .env
```

### 3. Execution
```bash
# Development mode
npm run dev

# Production Build
npm run build
```

---

## 🔐 Security & Architecture

BitMeet follows a **Decentralized Signaling** pattern. 
1. **Discovery**: Participants use Firebase Firestore as a virtual "lobby" to exchange Peer IDs.
2. **Handshake**: Direct WebRTC signaling is established.
3. **Media**: Audio, Video, and Screen data are streamed directly between browsers using DTLS-SRTP encryption.

### Recommended Firestore Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId}/participants/{participantId} {
      allow read: if true;
      allow write: if request.resource.data.keys().hasAll(['peerId', 'username']);
    }
  }
}
```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Developed with ❤️ by [Inled Group](https://github.com/InledGroup)**
*Premium Software Architecture for the Modern Web*
