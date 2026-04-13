import { importKey, encrypt, decrypt } from "./crypto";

self.onmessage = async (e: MessageEvent) => {
  const { type, keyEncoded } = e.data;
  try {
    const key = await importKey(keyEncoded);

    if (type === "encrypt") {
      const { fileName, fileBuffer } = e.data;
      const ciphertext = await encrypt(fileName, fileBuffer, key);
      self.postMessage({ ciphertext }, [ciphertext.buffer]);
    } else if (type === "decrypt") {
      const { ciphertext } = e.data;
      const { fileName, fileData } = await decrypt(new Uint8Array(ciphertext), key);
      self.postMessage({ fileName, fileData }, [fileData.buffer]);
    }
  } catch (err: any) {
    self.postMessage({ error: err.message });
  }
};
