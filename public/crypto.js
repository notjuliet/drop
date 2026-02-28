// AES-256-GCM helpers using Web Crypto API
// Each upload gets a unique key, so a fixed zero IV is safe.
// Filename + file body are packed into a single blob before encryption,
// so only one (key, IV) pair is ever used.

const IV = new Uint8Array(12); // 12 zero bytes
const PADDING_BLOCK = 4096;

export async function generateKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return {
    key,
    encoded: new Uint8Array(raw).toBase64({
      alphabet: "base64url",
      omitPadding: true,
    }),
  };
}

export async function importKey(encoded) {
  const raw = Uint8Array.fromBase64(encoded, { alphabet: "base64url" });
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// Pack: [u16 filenameLen][u64 fileLen][filename][file][zero padding to 4K boundary]
// Then encrypt the whole thing as one AES-GCM ciphertext.
export async function encrypt(fileName, fileBuffer, key) {
  const nameBytes = new TextEncoder().encode(fileName);
  if (nameBytes.length > 0xffff) throw new Error("Filename too long");

  const headerSize = 2 + 8; // u16 + u64
  const payloadSize = headerSize + nameBytes.length + fileBuffer.byteLength;
  const paddedSize = Math.ceil(payloadSize / PADDING_BLOCK) * PADDING_BLOCK;

  const buf = new ArrayBuffer(paddedSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Header
  view.setUint16(0, nameBytes.length, false); // big-endian
  // u64 file length — DataView has no setUint64, use two u32s
  const fileLen = fileBuffer.byteLength;
  view.setUint32(2, Math.floor(fileLen / 0x100000000), false); // high 32
  view.setUint32(6, fileLen >>> 0, false); // low 32

  // Filename + file body
  bytes.set(nameBytes, headerSize);
  bytes.set(new Uint8Array(fileBuffer), headerSize + nameBytes.length);

  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: IV }, key, buf);
  return new Uint8Array(ct);
}

// Decrypt and unpack — returns { fileName, fileData }
export async function decrypt(ciphertext, key) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: IV },
    key,
    ciphertext,
  );

  const view = new DataView(plain);
  const nameLen = view.getUint16(0, false);
  const fileLenHi = view.getUint32(2, false);
  const fileLenLo = view.getUint32(6, false);
  const fileLen = fileLenHi * 0x100000000 + fileLenLo;

  const headerSize = 2 + 8;
  const nameBytes = new Uint8Array(plain, headerSize, nameLen);
  const fileName = new TextDecoder().decode(nameBytes);
  const fileData = new Uint8Array(plain, headerSize + nameLen, fileLen);

  return { fileName, fileData };
}
