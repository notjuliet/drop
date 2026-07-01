export type UploadFileBuffer = {
  fileName: string;
  fileBuffer: ArrayBuffer;
};

type RemovedRange = [start: number, end: number];

const JPEG_SOI = 0xffd8;
const JPEG_APP1 = 0xffe1;
const JPEG_EXIF = 0x45786966;

const PNG_SIGNATURE_HIGH = 0x89504e47;
const PNG_SIGNATURE_LOW = 0x0d0a1a0a;
const PNG_METADATA_CHUNKS = new Set([
  0x65584966, // eXIf
  0x74494d45, // tIME
  0x69545874, // iTXt
  0x74455874, // tEXt
  0x7a545874, // zTXt
  0x64534947, // dSIG
]);

const RIFF = 0x52494646;
const WEBP = 0x57454250;
const WEBP_EXIF = 0x46495845;
const WEBP_XMP = 0x20504d58;

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

function stripImageMetadata(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ranges: RemovedRange[] = [];

  if (isJpeg(view)) {
    collectJpegMetadataRanges(view, ranges);
  } else if (isPng(view)) {
    collectPngMetadataRanges(view, ranges);
  } else if (isWebp(view)) {
    collectWebpMetadataRanges(view, ranges);
  }

  if (ranges.length === 0) {
    return null;
  }

  const stripped = copyWithoutRanges(bytes, ranges);
  if (isWebp(view)) {
    new DataView(stripped.buffer).setUint32(4, stripped.byteLength - 8, true);
  }

  return stripped;
}

function isJpeg(view: DataView): boolean {
  return view.byteLength >= 2 && view.getUint16(0) === JPEG_SOI;
}

function collectJpegMetadataRanges(view: DataView, ranges: RemovedRange[]): void {
  let pos = 2;

  while (pos + 9 <= view.byteLength) {
    const marker = view.getUint16(pos);
    if (marker === 0xffff) {
      pos++;
      continue;
    }

    if (!isKnownJpegSegment(marker)) {
      break;
    }

    const length = view.getUint16(pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > view.byteLength) {
      break;
    }

    const isExifApp1 =
      marker === JPEG_APP1 &&
      view.getUint32(pos + 4) === JPEG_EXIF &&
      view.getUint16(pos + 8) === 0;
    if (isExifApp1) {
      ranges.push([pos, end]);
    }

    pos = end;
  }
}

function isKnownJpegSegment(marker: number): boolean {
  return (
    (marker >= 0xffe0 && marker <= 0xffef) ||
    marker === 0xfffe ||
    marker === 0xffc0 ||
    marker === 0xffc2 ||
    marker === 0xffc4 ||
    marker === 0xffdb ||
    marker === 0xffdd ||
    marker === 0xffda
  );
}

function isPng(view: DataView): boolean {
  return (
    view.byteLength >= 8 &&
    view.getUint32(0) === PNG_SIGNATURE_HIGH &&
    view.getUint32(4) === PNG_SIGNATURE_LOW
  );
}

function collectPngMetadataRanges(view: DataView, ranges: RemovedRange[]): void {
  let pos = 8;

  while (pos + 12 <= view.byteLength) {
    const length = view.getUint32(pos);
    const marker = view.getUint32(pos + 4);
    const end = pos + length + 12;
    if (end > view.byteLength) {
      break;
    }

    if (PNG_METADATA_CHUNKS.has(marker)) {
      ranges.push([pos, end]);
    }

    pos = end;
  }
}

function isWebp(view: DataView): boolean {
  return view.byteLength >= 12 && view.getUint32(0) === RIFF && view.getUint32(8) === WEBP;
}

function collectWebpMetadataRanges(view: DataView, ranges: RemovedRange[]): void {
  let pos = 12;

  while (pos + 8 <= view.byteLength) {
    const marker = view.getUint32(pos, true);
    const length = view.getUint32(pos + 4, true);
    const end = pos + length + 8;
    const paddedEnd = end + (length & 1);
    if (paddedEnd > view.byteLength) {
      break;
    }

    if (marker === WEBP_EXIF || marker === WEBP_XMP) {
      ranges.push([pos, paddedEnd]);
    }

    pos = paddedEnd;
  }
}

function copyWithoutRanges(bytes: Uint8Array, ranges: RemovedRange[]): Uint8Array {
  const size = ranges.reduce((total, [start, end]) => total - (end - start), bytes.byteLength);
  const stripped = new Uint8Array(size);
  let sourceOffset = 0;
  let targetOffset = 0;

  for (const [start, end] of ranges) {
    stripped.set(bytes.subarray(sourceOffset, start), targetOffset);
    targetOffset += start - sourceOffset;
    sourceOffset = end;
  }

  stripped.set(bytes.subarray(sourceOffset), targetOffset);
  return stripped;
}

export function stripExifFromBuffer(buffer: ArrayBuffer) {
  const stripped = stripImageMetadata(new Uint8Array(buffer));
  return stripped === null ? buffer : exactArrayBuffer(stripped);
}

export async function prepareFileForUpload(file: File, index: number): Promise<UploadFileBuffer> {
  const buffer = await file.arrayBuffer();

  return {
    fileName: file.name || `file-${index + 1}`,
    fileBuffer: stripExifFromBuffer(buffer),
  };
}
