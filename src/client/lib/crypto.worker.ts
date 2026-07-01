import { importKey, encrypt, encryptFiles, decrypt } from "./crypto";

function postWithTransfer(message: unknown, transfer: Transferable[]) {
  (
    self as unknown as { postMessage: (message: unknown, transfer: Transferable[]) => void }
  ).postMessage(message, transfer);
}

self.onmessage = async (e: MessageEvent) => {
  const { type, keyEncoded } = e.data;
  try {
    const key = await importKey(keyEncoded);

    if (type === "encrypt") {
      const { fileName, fileBuffer } = e.data;
      const ciphertext = await encrypt(fileName, fileBuffer, key);
      postWithTransfer({ ciphertext }, [ciphertext.buffer]);
    } else if (type === "encryptFiles") {
      const { files } = e.data;
      const ciphertext = await encryptFiles(files, key);
      postWithTransfer({ ciphertext }, [ciphertext.buffer]);
    } else if (type === "decrypt") {
      const { ciphertext } = e.data;
      const { files } = await decrypt(new Uint8Array(ciphertext), key);
      const transfer = Array.from(new Set(files.map((f) => f.fileData.buffer)));
      postWithTransfer(
        {
          files,
          fileName: files[0]?.fileName,
          fileData: files[0]?.fileData,
        },
        transfer,
      );
    }
  } catch (err: any) {
    self.postMessage({ error: err.message });
  }
};
