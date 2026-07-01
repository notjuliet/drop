import { extname, join, normalize, resolve, sep } from "node:path";

import { config } from "./config.ts";
import { cleanExpired } from "./db.ts";
import { downloadFile, getFileInfo, uploadFile } from "./file.ts";
import { applySecurityHeaders, json } from "./security.ts";

const CLIENT_DIR = resolve(process.cwd(), "dist/client");

const CONTENT_TYPES: Record<string, string> = {
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

function infoRoute(): Response {
  return json({
    maxFileSize: config.maxFileSize,
    maxTtl: config.maxTtl,
  });
}

function fileInfoRoute(request: Bun.BunRequest<"/api/file/:id/info">): Response {
  return getFileInfo(request.params.id);
}

function fileDownloadRoute(request: Bun.BunRequest<"/api/file/:id">): Response {
  return downloadFile(request.params.id);
}

async function fetchFallback(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "Not found" }, 404);
  }

  return serveClient(url.pathname);
}

async function serveClient(pathname: string): Promise<Response> {
  const relativePath = safeRelativePath(pathname === "/" ? "/index.html" : pathname);
  if (!relativePath) {
    return textResponse("Not found", 404);
  }

  const filePath = resolve(CLIENT_DIR, relativePath);
  if (!isInsideClientDir(filePath)) {
    return textResponse("Not found", 404);
  }

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return fileResponse(file, filePath);
  }

  const indexPath = join(CLIENT_DIR, "index.html");
  const index = Bun.file(indexPath);
  if (await index.exists()) {
    return fileResponse(index, indexPath);
  }

  return textResponse("Client build not found. Run `bun run build` first.", 404);
}

function fileResponse(file: Bun.BunFile, filePath: string): Response {
  const headers = applySecurityHeaders();
  headers.set("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
  return new Response(file, {
    headers,
  });
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
  return filePath === CLIENT_DIR || filePath.startsWith(`${CLIENT_DIR}${sep}`);
}

// Clean expired uploads every 5 minutes
setInterval(cleanExpired, 5 * 60 * 1000);

const port = config.port;
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  maxRequestBodySize: config.maxFileSize,
  routes: {
    "/api/info": {
      GET: infoRoute,
    },
    "/api/file": {
      POST: uploadFile,
    },
    "/api/file/": {
      POST: uploadFile,
    },
    "/api/file/:id/info": {
      GET: fileInfoRoute,
    },
    "/api/file/:id": {
      GET: fileDownloadRoute,
    },
  },
  fetch: fetchFallback,
  error(error: unknown) {
    console.error(error);
    return json({ error: "Something went wrong." }, 500);
  },
};
