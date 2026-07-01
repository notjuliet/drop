// AES-256-GCM helpers using Web Crypto API
// Each upload gets a unique key, so a fixed zero IV is safe.
// Filename + file body are packed into a single blob before encryption,
// so only one (key, IV) pair is ever used.

const IV = new Uint8Array(12); // 12 zero bytes
const PADDING_BLOCK = 4096;
const SINGLE_HEADER_SIZE = 2 + 8; // u16 filenameLen + u64 fileLen
const BUNDLE_MAGIC = new Uint8Array([0x44, 0x52, 0x4f, 0x50, 0x42, 0x4e, 0x44, 0x31]); // DROPBND1
const BUNDLE_HEADER_SIZE = BUNDLE_MAGIC.length + 4; // magic + u32 fileCount
const MAX_BUNDLE_FILES = 1000;

export type EncryptFileInput = {
  fileName: string;
  fileBuffer: ArrayBuffer;
};

export type DecryptedFile = {
  fileName: string;
  fileData: Uint8Array<ArrayBuffer>;
};

export async function generateKey() {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = await crypto.subtle.exportKey("raw", key);
  return {
    key,
    encoded: new Uint8Array(raw).toBase64({
      alphabet: "base64url",
      omitPadding: true,
    }),
  };
}

export async function importKey(encoded: string) {
  const raw = Uint8Array.fromBase64(encoded, { alphabet: "base64url" });
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function paddedSize(size: number): number {
  return Math.ceil(size / PADDING_BLOCK) * PADDING_BLOCK;
}

function setUint64(view: DataView, offset: number, value: number) {
  view.setUint32(offset, Math.floor(value / 0x100000000), false);
  view.setUint32(offset + 4, value >>> 0, false);
}

function getUint64(view: DataView, offset: number): number {
  return view.getUint32(offset, false) * 0x100000000 + view.getUint32(offset + 4, false);
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

function validateFileName(nameBytes: Uint8Array) {
  if (nameBytes.length > 0xffff) throw new Error("Filename too long");
}

// Pack: [u16 filenameLen][u64 fileLen][filename][file][zero padding to 4K boundary]
// Then encrypt the whole thing as one AES-GCM ciphertext.
export async function encrypt(fileName: string, fileBuffer: ArrayBuffer, key: CryptoKey) {
  const nameBytes = new TextEncoder().encode(fileName);
  validateFileName(nameBytes);

  const payloadSize = SINGLE_HEADER_SIZE + nameBytes.length + fileBuffer.byteLength;
  const buf = new ArrayBuffer(paddedSize(payloadSize));

  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Header
  view.setUint16(0, nameBytes.length, false); // big-endian
  setUint64(view, 2, fileBuffer.byteLength);

  // Filename + file body
  bytes.set(nameBytes, SINGLE_HEADER_SIZE);
  bytes.set(new Uint8Array(fileBuffer), SINGLE_HEADER_SIZE + nameBytes.length);

  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: IV }, key, buf);
  return new Uint8Array(ct);
}

// Multi-file pack:
// [DROPBND1][u32 fileCount] repeated [u16 filenameLen][u64 fileLen][filename][file][zero padding]
export async function encryptFiles(files: EncryptFileInput[], key: CryptoKey) {
  if (files.length === 0) throw new Error("No files selected");
  if (files.length > MAX_BUNDLE_FILES)
    throw new Error(`Too many files; maximum is ${MAX_BUNDLE_FILES}`);
  if (files.length === 1) {
    const f = files[0]!;
    return encrypt(f.fileName, f.fileBuffer, key);
  }

  const entries = files.map((f) => {
    const nameBytes = new TextEncoder().encode(f.fileName);
    validateFileName(nameBytes);
    return { ...f, nameBytes };
  });
  const payloadSize =
    BUNDLE_HEADER_SIZE +
    entries.reduce(
      (sum, f) => sum + SINGLE_HEADER_SIZE + f.nameBytes.length + f.fileBuffer.byteLength,
      0,
    );
  const buf = new ArrayBuffer(paddedSize(payloadSize));
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  bytes.set(BUNDLE_MAGIC, offset);
  offset += BUNDLE_MAGIC.length;
  view.setUint32(offset, entries.length, false);
  offset += 4;

  for (const f of entries) {
    view.setUint16(offset, f.nameBytes.length, false);
    offset += 2;
    setUint64(view, offset, f.fileBuffer.byteLength);
    offset += 8;
    bytes.set(f.nameBytes, offset);
    offset += f.nameBytes.length;
    bytes.set(new Uint8Array(f.fileBuffer), offset);
    offset += f.fileBuffer.byteLength;
  }

  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: IV }, key, buf);
  return new Uint8Array(ct);
}

// Decrypt and unpack. Supports both the legacy single-file format and bundle format.
export async function decrypt(ciphertext: Uint8Array<ArrayBuffer>, key: CryptoKey) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: IV }, key, ciphertext);
  const view = new DataView(plain);
  const bytes = new Uint8Array(plain);

  if (startsWith(bytes, BUNDLE_MAGIC)) {
    let offset = BUNDLE_MAGIC.length;
    const count = view.getUint32(offset, false);
    offset += 4;
    if (count > MAX_BUNDLE_FILES) throw new Error("Too many files in bundle");
    const files: DecryptedFile[] = [];

    for (let i = 0; i < count; i++) {
      const nameLen = view.getUint16(offset, false);
      offset += 2;
      const fileLen = getUint64(view, offset);
      offset += 8;
      if (!Number.isSafeInteger(fileLen) || offset + nameLen + fileLen > plain.byteLength) {
        throw new Error("Invalid bundle");
      }
      const fileName = new TextDecoder().decode(new Uint8Array(plain, offset, nameLen));
      offset += nameLen;
      const fileData = new Uint8Array(plain, offset, fileLen);
      offset += fileLen;
      files.push({ fileName, fileData });
    }

    return { files };
  }

  const nameLen = view.getUint16(0, false);
  const fileLen = getUint64(view, 2);
  if (!Number.isSafeInteger(fileLen) || SINGLE_HEADER_SIZE + nameLen + fileLen > plain.byteLength) {
    throw new Error("Invalid file");
  }

  const nameBytes = new Uint8Array(plain, SINGLE_HEADER_SIZE, nameLen);
  const fileName = new TextDecoder().decode(nameBytes);
  const fileData = new Uint8Array(plain, SINGLE_HEADER_SIZE + nameLen, fileLen);

  return { files: [{ fileName, fileData }] };
}
