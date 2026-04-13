export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif"]);

export const TEXT_EXTS = new Set([
  "txt",
  "md",
  "js",
  "ts",
  "jsx",
  "tsx",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "css",
  "sh",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "php",
  "sql",
  "csv",
  "log",
  "ini",
  "env",
]);

export const VIDEO_EXTS = new Set(["mp4", "webm", "ogv", "mov"]);

export const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);

export const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/mp4",
};

export const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
};

export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
};

export function getExt(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${parseFloat((n / 1e3).toFixed(1))} KB`;
  if (n < 1e9) return `${parseFloat((n / 1e6).toFixed(1))} MB`;
  return `${parseFloat((n / 1e9).toFixed(2))} GB`;
}

export function formatExpiry(unixSec: number): string {
  const secs = unixSec - Math.floor(Date.now() / 1000);
  if (secs < 60) return "expires in less than a minute";
  const mins = Math.floor(secs / 60);
  if (secs < 3600) return `expires in ${mins} ${mins === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(secs / 3600);
  if (secs < 86400) return `expires in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(secs / 86400);
  return `expires in ${days} ${days === 1 ? "day" : "days"}`;
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
