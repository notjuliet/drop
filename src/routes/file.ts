import { Hono } from "hono";
import { createFile, getFile, peekFile, unlinkFile } from "../db.ts";
import { rateLimit } from "../middleware/rateLimit.ts";
import { config } from "../config.ts";

const DURATION_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

function parseDuration(s: string): number | undefined {
  const n = parseInt(s);
  const mult = DURATION_UNITS[s.slice(-1)];
  if (isNaN(n) || mult === undefined) return undefined;
  return n * mult;
}

const FILES_DIR = `${config.dataDir}/files`;
const MAX_FILE_SIZE = config.maxFileSize;
const MAX_TTL = parseDuration(config.maxTtl)!;

const file = new Hono();

file.post("/", rateLimit, async (c) => {
  const formData = await c.req.formData();
  const fileField = formData.get("file");
  const expiresIn = formData.get("expiresIn");
  const burnAfterRead = formData.get("burnAfterRead") === "true";

  if (!fileField || !(fileField instanceof File)) {
    return c.json({ error: "file field is required" }, 400);
  }

  if (fileField.size > MAX_FILE_SIZE) {
    return c.json({ error: "File too large" }, 413);
  }

  const expiresInStr = typeof expiresIn === "string" ? expiresIn.trim() : "";
  const expiresInSec = expiresInStr ? parseDuration(expiresInStr) : undefined;
  if (!expiresInSec) {
    return c.json(
      { error: "Invalid expiresIn. Use a duration like 30m, 24h, 7d" },
      400,
    );
  }
  if (expiresInSec > MAX_TTL) {
    return c.json({ error: "expiresIn exceeds maximum allowed TTL" }, 400);
  }

  const id = crypto.randomUUID();
  const deleteToken = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSec;
  const filePath = `${FILES_DIR}/${id}`;

  const buffer = await fileField.arrayBuffer();
  await Bun.write(filePath, buffer);

  try {
    createFile(id, expiresAt, burnAfterRead, deleteToken);
  } catch (err) {
    unlinkFile(id);
    throw err;
  }

  return c.json({ id, deleteToken });
});

file.on(["HEAD", "GET"], "/:id", (c) => {
  const id = c.req.param("id");
  const isHead = c.req.method === "HEAD";
  const row = isHead ? peekFile(id) : getFile(id);

  if (!row) {
    return c.json({ error: "File not found or expired" }, 404);
  }

  const filePath = `${FILES_DIR}/${id}`;
  const bunFile = Bun.file(filePath);

  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Length": String(bunFile.size),
    "X-Expires-At": String(row.expires_at),
    "X-Burn-After-Read": row.burn_after_read ? "1" : "0",
  });

  const response = new Response(bunFile, { headers });

  if (!isHead && row.burn_after_read) {
    setTimeout(() => unlinkFile(id), 0);
  }

  return response;
});

export default file;
