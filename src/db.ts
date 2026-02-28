import { Database } from "bun:sqlite";
import { mkdirSync, unlinkSync } from "fs";
import { config } from "./config.ts";

const DATA_DIR = config.dataDir;
const FILES_DIR = `${DATA_DIR}/files`;
mkdirSync(FILES_DIR, { recursive: true });

const db = new Database(`${DATA_DIR}/drop.db`, { create: true });
db.run("PRAGMA journal_mode = WAL;");

db.run(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    burn_after_read INTEGER NOT NULL DEFAULT 0,
    delete_token TEXT NOT NULL
  );
`);

const insertStmt = db.prepare<void, [string, number, number, string]>(
  "INSERT INTO files (id, expires_at, burn_after_read, delete_token) VALUES (?, ?, ?, ?)",
);

type FileRow = {
  id: string;
  expires_at: number;
  burn_after_read: number;
  delete_token: string;
};

const selectStmt = db.prepare<FileRow, [string]>(
  "SELECT * FROM files WHERE id = ?",
);

const deleteStmt = db.prepare<void, [string]>("DELETE FROM files WHERE id = ?");

const burnStmt = db.prepare<FileRow, [string]>(
  "DELETE FROM files WHERE id = ? AND burn_after_read = 1 RETURNING *",
);

const deleteWithTokenStmt = db.prepare<void, [string, string]>(
  "DELETE FROM files WHERE id = ? AND delete_token = ?",
);

const cleanStmt = db.prepare<{ id: string }, [number]>(
  "DELETE FROM files WHERE expires_at <= ? RETURNING id",
);

export function createFile(
  id: string,
  expiresAt: number,
  burnAfterRead: boolean,
  deleteToken: string,
): void {
  insertStmt.run(id, expiresAt, burnAfterRead ? 1 : 0, deleteToken);
}

// Read-only lookup — does not trigger burn-after-read or delete expired rows
export function peekFile(id: string) {
  const row = selectStmt.get(id);
  if (!row) return null;
  if (row.expires_at <= Math.floor(Date.now() / 1000)) return null;
  return row;
}

export function getFile(id: string) {
  // Try atomic burn-after-read first — if the row has burn_after_read=1,
  // this deletes and returns it in one step, preventing double-reads
  const burned = burnStmt.get(id);
  if (burned) {
    if (burned.expires_at <= Math.floor(Date.now() / 1000)) return null;
    return burned;
  }
  const row = selectStmt.get(id);
  if (!row) return null;
  if (row.expires_at <= Math.floor(Date.now() / 1000)) {
    deleteStmt.run(id);
    return null;
  }
  return row;
}

export function unlinkFile(id: string): void {
  try {
    unlinkSync(`${FILES_DIR}/${id}`);
  } catch {}
}

export function deleteFile(id: string, token: string): boolean {
  const result = deleteWithTokenStmt.run(id, token);
  if (!result.changes) return false;
  unlinkFile(id);
  return true;
}

export function cleanExpired(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const { id } of cleanStmt.all(now)) {
    unlinkFile(id);
  }
}
