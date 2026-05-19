import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dataDir = mkdtempSync(join(tmpdir(), "drop-test-"));
process.env.DATA_DIR = dataDir;
process.env.MAX_FILE_SIZE = "64";
process.env.MAX_TTL = "1h";

const { default: fileRoute } = await import("../src/file.ts");
const { cleanExpired, createFile, getFile, peekFile } = await import("../src/db.ts");

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function uploadForm(
  contents: string | Uint8Array,
  options: { expiresIn?: string; burnAfterRead?: boolean; name?: string } = {},
) {
  const form = new FormData();
  form.set("file", new File([contents], options.name ?? "note.txt"));
  if (options.expiresIn !== undefined) form.set("expiresIn", options.expiresIn);
  if (options.burnAfterRead !== undefined) {
    form.set("burnAfterRead", String(options.burnAfterRead));
  }
  return form;
}

async function upload(contents: string, options: { burnAfterRead?: boolean } = {}) {
  const response = await fileRoute.request("/", {
    method: "POST",
    body: uploadForm(contents, { expiresIn: "5m", ...options }),
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { id: string };
  expect(body.id).toBeTruthy();
  return body.id;
}

describe("file route", () => {
  test("uploads a file, exposes metadata, and downloads the bytes", async () => {
    const id = await upload("hello drop");

    const infoResponse = await fileRoute.request(`/${id}/info`);
    expect(infoResponse.status).toBe(200);
    expect(await infoResponse.json()).toMatchObject({
      id,
      burnAfterRead: false,
      size: 10,
    });

    const downloadResponse = await fileRoute.request(`/${id}`);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(downloadResponse.headers.get("Content-Length")).toBe("10");
    expect(await downloadResponse.text()).toBe("hello drop");

    expect((await fileRoute.request(`/${id}/info`)).status).toBe(200);
  });

  test("burn-after-read files are unavailable after the first download", async () => {
    const id = await upload("secret", { burnAfterRead: true });

    const firstDownload = await fileRoute.request(`/${id}`);
    expect(firstDownload.status).toBe(200);
    expect(await firstDownload.text()).toBe("secret");

    expect((await fileRoute.request(`/${id}/info`)).status).toBe(404);
    expect((await fileRoute.request(`/${id}`)).status).toBe(404);
  });

  test("rejects uploads without a file", async () => {
    const response = await fileRoute.request("/", {
      method: "POST",
      body: new FormData(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "file field is required" });
  });

  test("rejects uploads above the configured size limit", async () => {
    const response = await fileRoute.request("/", {
      method: "POST",
      body: uploadForm(new Uint8Array(65), { expiresIn: "5m" }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "File too large" });
  });

  test("rejects invalid and excessive lifetimes", async () => {
    const invalidResponse = await fileRoute.request("/", {
      method: "POST",
      body: uploadForm("hello", { expiresIn: "15x" }),
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      error: "Invalid lifetime. Use a duration like 30m, 24h, 7d",
    });

    const excessiveResponse = await fileRoute.request("/", {
      method: "POST",
      body: uploadForm("hello", { expiresIn: "2h" }),
    });
    expect(excessiveResponse.status).toBe(400);
    expect(await excessiveResponse.json()).toEqual({
      error: "expiresIn exceeds maximum allowed TTL",
    });
  });
});

describe("file database", () => {
  test("treats expired rows as unavailable and cleans up expired files", async () => {
    const now = Math.floor(Date.now() / 1000);
    const lookupId = `expired-lookup-${crypto.randomUUID()}`;
    const cleanupId = `expired-cleanup-${crypto.randomUUID()}`;
    const cleanupPath = join(dataDir, "files", cleanupId);

    createFile(lookupId, now - 1, false);
    expect(peekFile(lookupId)).toBeNull();
    expect(getFile(lookupId)).toBeNull();
    expect(peekFile(lookupId)).toBeNull();

    await Bun.write(cleanupPath, "stale");
    createFile(cleanupId, now - 1, false);

    cleanExpired();

    expect(peekFile(cleanupId)).toBeNull();
    expect(existsSync(cleanupPath)).toBe(false);
  });
});
