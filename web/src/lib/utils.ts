export const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "tiff",
  "avif",
]);

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

export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  avif: "image/avif",
};

export function getExt(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatExpiry(unixSec: number): string {
  const secs = unixSec - Math.floor(Date.now() / 1000);
  if (secs < 60) return "expires in less than a minute";
  if (secs < 3600) return `expires in ${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `expires in ${Math.floor(secs / 3600)}h`;
  return `expires in ${Math.floor(secs / 86400)}d`;
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
