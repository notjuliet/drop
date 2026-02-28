import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import file from "./routes/file.ts";
import del from "./routes/delete.ts";
import { cleanExpired } from "./db.ts";
import { config } from "./config.ts";

const app = new Hono();

app.route("/api/file", file);
app.route("/delete", del);

app.get("/p/:id", () => {
  return new Response(Bun.file("public/view.html"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.use("/*", serveStatic({ root: "./public" }));

// Clean expired uploads every 5 minutes
setInterval(cleanExpired, 5 * 60 * 1000);

const port = config.port;
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  maxRequestBodySize: config.maxFileSize,
  fetch: app.fetch,
};
