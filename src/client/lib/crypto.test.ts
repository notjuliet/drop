/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import { decrypt, encrypt, encryptFiles, generateKey, importKey } from "./crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(text: string) {
  return encoder.encode(text).buffer;
}

function text(data: Uint8Array) {
  return decoder.decode(data);
}

async function encryptPlaintext(plaintext: Uint8Array<ArrayBuffer>, key: CryptoKey) {
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(12) },
    key,
    plaintext,
  );
  return new Uint8Array(ciphertext);
}

describe("crypto helpers", () => {
  test("generates an importable AES key", async () => {
    const generated = await generateKey();
    const imported = await importKey(generated.encoded);
    const ciphertext = await encrypt("hello.txt", bytes("hello"), imported);

    const decrypted = await decrypt(ciphertext, generated.key);
    expect(decrypted.files).toHaveLength(1);
    expect(decrypted.files[0]).toMatchObject({ fileName: "hello.txt" });
    expect(text(decrypted.files[0]!.fileData)).toBe("hello");
  });

  test("pads single-file payloads to the fixed block size before encryption", async () => {
    const { key } = await generateKey();

    const shortCiphertext = await encrypt("a.txt", bytes("a"), key);
    const longerCiphertext = await encrypt("longer-name.txt", bytes("still small"), key);

    expect(shortCiphertext.byteLength).toBe(4096 + 16);
    expect(longerCiphertext.byteLength).toBe(shortCiphertext.byteLength);
  });

  test("round-trips multi-file bundles", async () => {
    const { key } = await generateKey();

    const ciphertext = await encryptFiles(
      [
        { fileName: "one.txt", fileBuffer: bytes("first") },
        { fileName: "nested/two.md", fileBuffer: bytes("# second") },
      ],
      key,
    );

    const decrypted = await decrypt(ciphertext, key);
    expect(decrypted.files.map((file) => file.fileName)).toEqual(["one.txt", "nested/two.md"]);
    expect(decrypted.files.map((file) => text(file.fileData))).toEqual(["first", "# second"]);
  });

  test("rejects empty bundles and oversized filenames", async () => {
    const { key } = await generateKey();

    expect(encryptFiles([], key)).rejects.toThrow("No files selected");
    await expect(
      encryptFiles([{ fileName: "x".repeat(0x10000), fileBuffer: bytes("body") }], key),
    ).rejects.toThrow("Filename too long");
  });

  test("rejects bundles with an invalid file count", async () => {
    const { key } = await generateKey();
    const plaintext = new Uint8Array(12);
    plaintext.set(encoder.encode("DROPBND1"), 0);
    new DataView(plaintext.buffer).setUint32(8, 1001, false);

    await expect(decrypt(await encryptPlaintext(plaintext, key), key)).rejects.toThrow(
      "Too many files in bundle",
    );
  });
});
