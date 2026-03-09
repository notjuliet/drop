import { createSignal, Show, onMount, onCleanup, createMemo } from "solid-js";

import { generateKey, encrypt } from "../lib/crypto";
import { formatBytes } from "../lib/utils";

export default function Upload() {
  const [file, setFile] = createSignal<File | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [encrypting, setEncrypting] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal("");
  const [resultUrl, setResultUrl] = createSignal("");
  const [dragging, setDragging] = createSignal(false);
  const [maxFileSize, setMaxFileSize] = createSignal(0);

  let fileInput!: HTMLInputElement;
  let linkInput!: HTMLInputElement;
  let expiryInput!: HTMLInputElement;
  let burnInput!: HTMLInputElement;
  let copyBtn!: HTMLButtonElement;
  let activeXhr: XMLHttpRequest | null = null;

  const RADIUS = 130;
  const CENTER = RADIUS + 10;
  const SIZE = CENTER * 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  let prevRatio = 0;
  const sizeRatio = createMemo(() => {
    const f = file();
    const max = maxFileSize();
    if (!f || !max) return 0;
    return Math.min(f.size / max, 1);
  });

  const animDuration = createMemo(() => {
    const cur = sizeRatio();
    const dur = Math.max(Math.max(cur, prevRatio) * 800, 200);
    prevRatio = cur;
    return dur;
  });

  const tooLarge = createMemo(() => {
    const f = file();
    const max = maxFileSize();
    return !!f && !!max && f.size > max;
  });

  const statusText = () => {
    if (encrypting()) return "Encrypting\u2026";
    if (uploading()) return "Uploading\u2026";
    return "";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    if (
      e.relatedTarget === null ||
      !document.body.contains(e.relatedTarget as Node)
    ) {
      setDragging(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files[0]) setFile(e.dataTransfer.files[0]);
  };

  onMount(async () => {
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);

    try {
      const res = await fetch("/api/info");
      if (res.ok) {
        const info = await res.json();
        setMaxFileSize(info.maxFileSize);
      }
    } catch {}
  });

  onCleanup(() => {
    document.removeEventListener("dragover", handleDragOver);
    document.removeEventListener("dragleave", handleDragLeave);
    document.removeEventListener("drop", handleDrop);
  });

  const cancelUpload = () => {
    if (activeXhr) {
      activeXhr.abort();
      activeXhr = null;
    }
    setUploading(false);
    setEncrypting(false);
    setProgress(0);
    removeFile();
  };

  const removeFile = () => {
    setFile(null);
    setError("");
    fileInput.value = "";
  };

  const handleUpload = async () => {
    const f = file();
    if (!f) return;

    setEncrypting(true);
    setUploading(true);
    setError("");
    setResultUrl("");
    setProgress(0);

    try {
      const { key, encoded } = await generateKey();
      const buffer = await f.arrayBuffer();
      const ciphertext = await encrypt(f.name || "file", buffer, key);

      const formData = new FormData();
      formData.append("file", new Blob([ciphertext]));
      formData.append("expiresIn", expiryInput.value.trim());
      formData.append("burnAfterRead", burnInput.checked ? "true" : "false");

      setEncrypting(false);

      const res = await new Promise<{ id: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXhr = xhr;
        xhr.open("POST", "/api/file");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || "Upload failed"));
            } catch {
              reject(new Error("Upload failed"));
            }
          }
        };

        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
      });

      const url = `${location.origin}/p/${res.id}#${encoded}`;
      setResultUrl(url);
      removeFile();
    } catch (e: any) {
      setError(e.message);
    } finally {
      activeXhr = null;
      setUploading(false);
      setEncrypting(false);
      setProgress(0);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(linkInput.value);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  };

  return (
    <>
      <div
        class="group relative mx-auto flex aspect-square w-[65vw] max-w-[500px] items-center justify-center"
        onClick={() => fileInput.click()}
      >
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          class="absolute inset-0 h-full w-full"
        >
          <defs>
            <clipPath id="circle-clip">
              <circle cx={CENTER} cy={CENTER} r={RADIUS - 2.5} />
            </clipPath>
          </defs>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={dragging() ? "var(--color-accent)" : "var(--color-border)"}
            stroke-width="5"
            stroke-dasharray={dragging() ? "6 4" : "none"}
            class="transition-all duration-200"
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={tooLarge() ? "var(--color-danger)" : "var(--color-accent)"}
            stroke-width="5"
            stroke-dasharray={`${CIRCUMFERENCE}`}
            stroke-dashoffset={`${CIRCUMFERENCE * (1 - (uploading() ? 0 : sizeRatio()))}`}
            stroke-linecap="round"
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{
              transition: `all ${animDuration()}ms ease-out`,
            }}
          />
          {/* Upload liquid fill */}
          <rect
            x={CENTER - RADIUS}
            y={CENTER - RADIUS + 2 * RADIUS * (1 - progress() / 100)}
            width={2 * RADIUS}
            height={2 * RADIUS * (progress() / 100)}
            fill="var(--color-accent)"
            opacity="0.15"
            clip-path="url(#circle-clip)"
            class="transition-all duration-300 ease-out"
          />
        </svg>

        <div class="z-10 flex flex-col items-center gap-1.5 text-center">
          <Show when={uploading()}>
            <span class="text-accent text-2xl font-medium tabular-nums">
              {progress()}%
            </span>
            <span class="text-muted text-[10px]">{statusText()}</span>
            <button
              class="text-muted hover:text-text mt-1 border-none bg-transparent p-0 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                cancelUpload();
              }}
            >
              cancel
            </button>
          </Show>
          <Show when={!uploading()}>
            <Show
              when={!file()}
              fallback={
                <>
                  <span class="text-text max-w-[160px] truncate font-mono text-xs">
                    {file()!.name}
                  </span>
                  <span
                    class={
                      tooLarge()
                        ? "text-danger text-xs font-medium"
                        : "text-muted text-xs"
                    }
                  >
                    {formatBytes(file()!.size)}
                    {tooLarge() ? ` / ${formatBytes(maxFileSize())} limit` : ""}
                  </span>
                  <button
                    class="bg-accent hover:bg-accent-hover mt-2 rounded-md border-none px-4 py-1.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={tooLarge()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpload();
                    }}
                  >
                    Upload
                  </button>
                  <button
                    class="text-muted hover:text-text mt-1 border-none bg-transparent p-0 text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile();
                    }}
                  >
                    remove
                  </button>
                </>
              }
            >
              <p class="text-muted text-sm font-medium">Drop a file</p>
              <span class="text-muted text-[10px]">or</span>
              <button
                class="bg-accent hover:bg-accent-hover rounded-md border-none px-4 py-1.5 text-sm font-medium text-white transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInput.click();
                }}
              >
                Browse
              </button>
              <Show when={maxFileSize()}>
                <span class="text-muted text-[10px]">
                  up to {formatBytes(maxFileSize())}
                </span>
              </Show>
            </Show>
          </Show>
        </div>

        <input
          type="file"
          ref={fileInput!}
          class="hidden"
          onChange={() => {
            if (fileInput.files?.[0]) setFile(fileInput.files[0]);
          }}
        />
      </div>

      <div class="mt-4 flex items-center gap-4">
        <input
          ref={expiryInput!}
          type="text"
          value="24h"
          placeholder="e.g. 30m, 24h, 7d"
          class="bg-surface border-border text-text focus:border-accent w-24 rounded-md border px-2.5 py-1.5 text-xs transition-colors outline-none"
        />
        <label class="text-muted flex items-center gap-1.5 text-xs select-none">
          <input type="checkbox" ref={burnInput!} class="accent-accent" />
          Burn after read
        </label>
      </div>

      <Show when={error()}>
        <div class="text-danger mt-4 text-xs">{error()}</div>
      </Show>

      <Show when={resultUrl()}>
        <div class="bg-surface border-border mt-6 rounded-lg border p-4">
          <label class="text-muted mb-1.5 block text-xs">drop link</label>
          <div class="flex gap-2">
            <input
              ref={linkInput!}
              type="text"
              readonly
              value={resultUrl()}
              class="bg-bg border-border text-text min-w-0 flex-1 rounded-md border px-2.5 py-1.5 font-mono text-xs outline-none"
            />
            <button
              ref={copyBtn!}
              class="bg-accent hover:bg-accent-hover shrink-0 rounded-md border-none px-3 py-1.5 text-xs font-medium text-white transition-colors"
              onClick={copyLink}
            >
              Copy
            </button>
          </div>
        </div>
      </Show>
    </>
  );
}
