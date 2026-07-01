import { config } from "./config.ts";
import { createFile, getFile, peekFile, unlinkFile } from "./db.ts";
import { apiHeaders, json, requireTrustedOrigin } from "./security.ts";

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

function parseDuration(s: string): number | undefined {
  const match = s.trim().match(/^(\d+)([smhd])$/);
  if (!match) return undefined;
  const n = Number(match[1]!);
  const mult = DURATION_UNITS[match[2]!];
  if (!Number.isSafeInteger(n) || n <= 0 || mult === undefined) return undefined;
  return n * mult;
}

const FILES_DIR = `${config.dataDir}/files`;
const MAX_FILE_SIZE = config.maxFileSize;
const MAX_TTL = parseDuration(config.maxTtl)!;

export async function uploadFile(request: Request): Promise<Response> {
  const originError = requireTrustedOrigin(request);
  if (originError) return originError;

  const form = await request.formData();
  const fileField = form.get("file");
  const expiresIn = form.get("expiresIn");
  const burnAfterRead = form.get("burnAfterRead") === "true";

  if (!fileField || !(fileField instanceof File)) {
    return json({ error: "file field is required" }, 400);
  }

  if (fileField.size > MAX_FILE_SIZE) {
    return json({ error: "File too large" }, 413);
  }

  const expiresInStr = typeof expiresIn === "string" ? expiresIn.trim() : "";
  const expiresInSec = expiresInStr ? parseDuration(expiresInStr) : undefined;
  if (!expiresInSec) {
    return json({ error: "Invalid lifetime. Use a duration like 30m, 24h, 7d" }, 400);
  }
  if (expiresInSec > MAX_TTL) {
    return json({ error: "expiresIn exceeds maximum allowed TTL" }, 400);
  }

  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSec;
  const filePath = `${FILES_DIR}/${id}`;

  const buffer = await fileField.arrayBuffer();
  await Bun.write(filePath, buffer);

  try {
    createFile(id, expiresAt, burnAfterRead);
  } catch (err) {
    unlinkFile(id);
    throw err;
  }

  return json({ id });
}

export function getFileInfo(id: string): Response {
  const row = peekFile(id);

  if (!row) {
    return json({ error: "File not found or expired" }, 404);
  }

  const bunFile = Bun.file(`${FILES_DIR}/${id}`);

  return json({
    id,
    expiresAt: row.expires_at,
    burnAfterRead: row.burn_after_read === 1,
    size: bunFile.size,
  });
}

export function downloadFile(id: string): Response {
  const row = getFile(id);

  if (!row) {
    return json({ error: "File not found or expired" }, 404);
  }

  const filePath = `${FILES_DIR}/${id}`;
  const bunFile = Bun.file(filePath);

  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Length": String(bunFile.size),
  });
  apiHeaders(headers);

  if (row.burn_after_read) {
    setTimeout(() => unlinkFile(id), 0);
  }

  return new Response(bunFile, { headers });
}
