/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import { stripExifFromBuffer } from "./exif";

const encoder = new TextEncoder();

function buffer(bytes: number[]) {
  return new Uint8Array(bytes).buffer;
}

function textBuffer(text: string) {
  return encoder.encode(text).buffer;
}

function ascii(text: string) {
  return Array.from(encoder.encode(text));
}

function u32be(value: number) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function pngChunk(type: string, data: number[]) {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

function webpChunk(type: string, data: number[]) {
  return [...ascii(type), ...u32le(data.length), ...data, ...(data.length & 1 ? [0] : [])];
}

describe("EXIF stripping helpers", () => {
  test("removes GPS data carried inside JPEG EXIF metadata", () => {
    const jpegWithGpsExif = buffer([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x16, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53,
      0x4c, 0x61, 0x74, 0x69, 0x74, 0x75, 0x64, 0x65, 0x52, 0x65, 0x66, 0xff, 0xda, 0x00, 0x08,
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0xff, 0xd9,
    ]);

    const stripped = stripExifFromBuffer(jpegWithGpsExif);
    const strippedBytes = new Uint8Array(stripped);

    expect(new TextDecoder().decode(strippedBytes)).not.toContain("GPS");
    expect(Array.from(strippedBytes)).toEqual([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0xff, 0xd9,
    ]);
  });

  test("removes JPEG EXIF segments before encryption", () => {
    const jpegWithExif = buffer([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x01, 0x02, 0xff,
      0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0xff, 0xd9,
    ]);

    const stripped = stripExifFromBuffer(jpegWithExif);
    const strippedBytes = Array.from(new Uint8Array(stripped));

    expect(stripped).not.toBe(jpegWithExif);
    expect(strippedBytes).toEqual([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0xff, 0xd9,
    ]);
  });

  test("removes PNG metadata and text chunks", () => {
    const pngWithMetadata = buffer([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...pngChunk("IHDR", [1, 2, 3, 4]),
      ...pngChunk("tEXt", ascii("GPSLatitude=secret")),
      ...pngChunk("eXIf", ascii("Exif secret")),
      ...pngChunk("IDAT", [5, 6, 7, 8]),
      ...pngChunk("IEND", []),
    ]);

    const stripped = stripExifFromBuffer(pngWithMetadata);
    const strippedBytes = new Uint8Array(stripped);
    const decoded = new TextDecoder().decode(strippedBytes);

    expect(decoded).not.toContain("GPSLatitude");
    expect(decoded).not.toContain("Exif");
    expect(decoded).toContain("IHDR");
    expect(decoded).toContain("IDAT");
    expect(decoded).toContain("IEND");
  });

  test("removes WebP EXIF and XMP chunks and updates RIFF size", () => {
    const chunks = [
      ...webpChunk("VP8 ", [1, 2, 3, 4]),
      ...webpChunk("EXIF", ascii("GPSLatitude=secret")),
      ...webpChunk("XMP ", ascii("xmp secret")),
    ];
    const webpWithMetadata = buffer([
      ...ascii("RIFF"),
      ...u32le(chunks.length + 4),
      ...ascii("WEBP"),
      ...chunks,
    ]);

    const stripped = stripExifFromBuffer(webpWithMetadata);
    const strippedBytes = new Uint8Array(stripped);
    const decoded = new TextDecoder().decode(strippedBytes);
    const riffSize = new DataView(stripped).getUint32(4, true);

    expect(decoded).not.toContain("GPSLatitude");
    expect(decoded).not.toContain("xmp");
    expect(decoded).toContain("VP8 ");
    expect(riffSize).toBe(strippedBytes.byteLength - 8);
  });

  test("leaves unsupported files untouched", () => {
    const plain = textBuffer("not an image");
    const stripped = stripExifFromBuffer(plain);

    expect(stripped).toBe(plain);
  });
});
