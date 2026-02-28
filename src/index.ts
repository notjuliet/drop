import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import { config } from "./config.ts";
import { cleanExpired } from "./db.ts";
import file from "./routes/file.ts";

const app = new Hono();

app.route("/api/file", file);

app.use("/*", serveStatic({ root: "./web/dist" }));

// SPA catch-all: serve index.html for unmatched routes
app.get("/*", () => {
  return new Response(Bun.file("web/dist/index.html"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

// Clean expired uploads every 5 minutes
setInterval(cleanExpired, 5 * 60 * 1000);

const port = config.port;
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  maxRequestBodySize: config.maxFileSize,
  fetch: app.fetch,
};
