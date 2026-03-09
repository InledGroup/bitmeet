export async function deriveKey(roomId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(roomId),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("bitmeet-salt-e2ee"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function encryptText(text: string, roomId: string): Promise<{ ciphertext: string, iv: string }> {
  const key = await deriveKey(roomId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encoded = enc.encode(text);
  
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  
  return { 
    ciphertext: arrayBufferToBase64(ciphertextBuf), 
    iv: arrayBufferToBase64(iv.buffer) 
  };
}

export async function decryptText(ciphertextBase64: string, ivBase64: string, roomId: string): Promise<string> {
  const key = await deriveKey(roomId);
  const iv = base64ToArrayBuffer(ivBase64);
  const ciphertextBuf = base64ToArrayBuffer(ciphertextBase64);
  
  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    ciphertextBuf
  );
  
  const dec = new TextDecoder();
  return dec.decode(decryptedBuf);
}
