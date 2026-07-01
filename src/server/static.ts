import { extname, join, normalize, resolve, sep } from "node:path";

import { applySecurityHeaders } from "./security.ts";

const clientDir = resolve(process.cwd(), "dist/client");

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export async function serveClient(pathname: string): Promise<Response> {
  const relativePath = safeRelativePath(pathname === "/" ? "/index.html" : pathname);
  if (!relativePath) {
    return textResponse("Not found", 404);
  }

  const filePath = resolve(clientDir, relativePath);
  if (!isInsideClientDir(filePath)) {
    return textResponse("Not found", 404);
  }

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return fileResponse(file, contentTypes[extname(filePath)] ?? "application/octet-stream");
  }

  const index = Bun.file(join(clientDir, "index.html"));
  if (await index.exists()) {
    return fileResponse(index, "text/html; charset=utf-8");
  }

  return textResponse("Client build not found. Run `bun run build` first.", 404);
}

function fileResponse(file: Bun.BunFile, contentType: string): Response {
  const headers = applySecurityHeaders();
  headers.set("Content-Type", contentType);
  return new Response(file, { headers });
}

function textResponse(body: string, status: number): Response {
  const headers = applySecurityHeaders();
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, {
    status,
    headers,
  });
}

function safeRelativePath(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return normalized.replace(/^[/\\]/, "") || "index.html";
}

function isInsideClientDir(filePath: string): boolean {
  return filePath === clientDir || filePath.startsWith(`${clientDir}${sep}`);
}
