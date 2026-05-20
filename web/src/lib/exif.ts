import { remove as removeExif } from "@mary/exif-rm";

export type UploadFileBuffer = {
  fileName: string;
  fileBuffer: ArrayBuffer;
};

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

export function stripExifFromBuffer(buffer: ArrayBuffer) {
  const stripped = removeExif(new Uint8Array(buffer));
  return stripped === null ? buffer : exactArrayBuffer(stripped);
}

export async function prepareFileForUpload(file: File, index: number): Promise<UploadFileBuffer> {
  const buffer = await file.arrayBuffer();

  return {
    fileName: file.name || `file-${index + 1}`,
    fileBuffer: stripExifFromBuffer(buffer),
  };
}
