import { config } from "./config.ts";
import { cleanExpired } from "./db.ts";
import { downloadFile, getFileInfo, uploadFile } from "./file.ts";
import { json } from "./security.ts";
import { serveClient } from "./static.ts";

type RoutePath = "/api/info" | "/api/file" | "/api/file/" | "/api/file/:id/info" | "/api/file/:id";

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

const serverOptions = {
  port: config.port,
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
} satisfies Bun.Serve.Options<undefined, RoutePath>;

export function startServer() {
  // Clean expired uploads every 5 minutes.
  setInterval(cleanExpired, 5 * 60 * 1000);

  const server = Bun.serve(serverOptions);
  console.log(`Server running on http://${server.hostname}:${server.port}`);
  return server;
}

if (import.meta.main) {
  startServer();
}
