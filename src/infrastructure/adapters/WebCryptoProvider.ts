export class WebCryptoProvider {
  async decryptPrivateKey(encryptedData: ArrayBuffer, password: string, salt: Uint8Array, iv: Uint8Array): Promise<CryptoKey> {
    const encryptionKey = await this.deriveKey(password, salt);
    const decryptedKeyBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      encryptionKey,
      encryptedData
    );
    return await window.crypto.subtle.importKey(
      "pkcs8",
      decryptedKeyBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"]
    );
  }

  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 600000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async sign(data: string, privateKey: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const signature = await window.crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      privateKey,
      encoder.encode(data)
    );
    return this.arrayBufferToBase64(signature);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }
}
