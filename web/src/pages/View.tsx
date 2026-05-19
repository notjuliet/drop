import { createSignal, Show, For, onMount, onCleanup, createMemo } from "solid-js";

import { importKey } from "../lib/crypto";
import { btnClass, btnStyle, fadeIn, fadeOut } from "../lib/ui";
import {
  formatBytes,
  formatExpiry,
  getExt,
  triggerDownload,
  IMAGE_EXTS,
  TEXT_EXTS,
  VIDEO_EXTS,
  IMAGE_MIME,
  VIDEO_MIME,
  AUDIO_MIME,
} from "../lib/utils";

const ghostClass =
  "text-muted hover:text-accent hover:border-accent border border-border bg-transparent rounded px-2 py-1 text-sm transition-colors";

const MODAL_ANIMATION_MS = 400;

function CloseIcon() {
  return (
    <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 4 8 8M12 4l-8 8"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function formatDuration(seconds: number) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isAudioOnlyWebm(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      v.removeAttribute("src");
      v.load();
      resolve(result);
    };
    v.onloadedmetadata = () => finish(v.videoWidth === 0 && v.videoHeight === 0);
    v.onerror = () => finish(true);
    setTimeout(() => finish(true), 2000);
    v.src = url;
  });
}

type Stage = "loading" | "meta" | "decrypting" | "content" | "error";
type ContentType = "text" | "image" | "video" | "audio" | "binary";
type ViewItem = {
  name: string;
  size: number;
  contentType: ContentType;
  textContent?: string;
  src?: string;
  blob?: Blob;
};

export default function View() {
  const parts = location.pathname.split("/").filter(Boolean);
  const id = parts[0] === "p" ? parts[1] : parts[0];

  const [stage, setStage] = createSignal<Stage>("loading");
  const [error, setError] = createSignal("");
  const [size, setSize] = createSignal(0);
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [burnAfterRead, setBurnAfterRead] = createSignal(false);
  const [burned, setBurned] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [decrypting, setDecrypting] = createSignal(false);

  const [items, setItems] = createSignal<ViewItem[]>([]);
  const [copiedItem, setCopiedItem] = createSignal<number | null>(null);
  const [selectedIndex, setSelectedIndex] = createSignal<number | null>(null);
  const [previewClosing, setPreviewClosing] = createSignal(false);
  const [videoDurations, setVideoDurations] = createSignal<Record<string, number>>({});
  const totalPlainSize = createMemo(() => items().reduce((sum, item) => sum + item.size, 0));
  const selectedItem = createMemo(() => {
    const index = selectedIndex();
    return index === null ? null : (items()[index] ?? null);
  });

  let objectUrls: string[] = [];
  let previewCloseTimer: number | null = null;
  const worker = new Worker(new URL("../lib/crypto.worker.ts", import.meta.url), {
    type: "module",
  });

  const clearPreviewCloseTimer = () => {
    if (previewCloseTimer === null) return;
    clearTimeout(previewCloseTimer);
    previewCloseTimer = null;
  };

  const clearObjectUrls = () => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  };

  onCleanup(() => {
    clearPreviewCloseTimer();
    clearObjectUrls();
    worker.terminate();
  });

  onMount(async () => {
    const keyEncoded = window.location.hash.slice(1);

    if (!id || !keyEncoded) {
      setError("Invalid URL.");
      setStage("error");
      return;
    }

    try {
      await importKey(keyEncoded);
    } catch {
      setError("Invalid key.");
      setStage("error");
      return;
    }

    const infoRes = await fetch(`/api/file/${id}/info`);
    if (!infoRes.ok) {
      setError("File not found or expired.");
      setStage("error");
      return;
    }

    const info = await infoRes.json();
    setSize(info.size);
    setExpiresAt(info.expiresAt);
    setBurnAfterRead(info.burnAfterRead);

    if (info.burnAfterRead) {
      setStage("meta");
    } else {
      handleView();
    }
  });

  const handleView = async () => {
    setStage("decrypting");
    setProgress(0);
    setDecrypting(false);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `/api/file/${id}`);
      xhr.responseType = "arraybuffer";

      const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
        xhr.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            setDecrypting(true);
            resolve(xhr.response);
          } else {
            reject(new Error("File not found or expired."));
          }
        };
        xhr.onerror = () => reject(new Error("Download failed."));
        xhr.send();
      });

      const { files } = await new Promise<{
        files: { fileName: string; fileData: Uint8Array<ArrayBuffer> }[];
      }>((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data);
        };
        worker.postMessage(
          {
            type: "decrypt",
            ciphertext: buf,
            keyEncoded: location.hash.slice(1),
          },
          [buf],
        );
      });

      if (burnAfterRead()) setBurned(true);

      clearObjectUrls();
      setVideoDurations({});
      const nextItems: ViewItem[] = [];

      for (const file of files) {
        const ext = getExt(file.fileName);
        const mime = IMAGE_MIME[ext] || VIDEO_MIME[ext] || AUDIO_MIME[ext] || undefined;

        if (mime) {
          const blob = new Blob([file.fileData], { type: mime });
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          if (IMAGE_EXTS.has(ext)) {
            nextItems.push({
              name: file.fileName,
              size: file.fileData.byteLength,
              contentType: "image",
              src: url,
              blob,
            });
          } else if (VIDEO_EXTS.has(ext)) {
            nextItems.push({
              name: file.fileName,
              size: file.fileData.byteLength,
              contentType: ext === "webm" && (await isAudioOnlyWebm(url)) ? "audio" : "video",
              src: url,
              blob,
            });
          } else {
            nextItems.push({
              name: file.fileName,
              size: file.fileData.byteLength,
              contentType: "audio",
              src: url,
              blob,
            });
          }
        } else if (TEXT_EXTS.has(ext)) {
          nextItems.push({
            name: file.fileName,
            size: file.fileData.byteLength,
            contentType: "text",
            textContent: new TextDecoder().decode(file.fileData),
          });
        } else {
          nextItems.push({
            name: file.fileName,
            size: file.fileData.byteLength,
            contentType: "binary",
            blob: new Blob([file.fileData]),
          });
        }
      }

      setItems(nextItems);
      clearPreviewCloseTimer();
      setPreviewClosing(false);
      setSelectedIndex(null);
      setStage("content");
    } catch (e: any) {
      setError(e.message || "Failed to decrypt.");
      setStage("error");
    }
  };

  const copyText = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(index);
    setTimeout(() => setCopiedItem(null), 1500);
  };

  const blobForItem = (item: ViewItem) => {
    if (item.contentType === "text") {
      return new Blob([item.textContent ?? ""], { type: "text/plain" });
    }
    return item.blob ?? null;
  };

  const saveFile = (item: ViewItem) => {
    const blob = blobForItem(item);
    if (blob) triggerDownload(blob, item.name);
  };

  const saveAll = () => {
    items().forEach(saveFile);
  };

  const openItem = (index: number) => {
    clearPreviewCloseTimer();
    setPreviewClosing(false);
    setSelectedIndex(index);
  };

  const closeItem = () => {
    if (selectedIndex() === null || previewClosing()) return;
    setPreviewClosing(true);
    previewCloseTimer = window.setTimeout(() => {
      setSelectedIndex(null);
      setPreviewClosing(false);
      previewCloseTimer = null;
    }, MODAL_ANIMATION_MS);
  };

  const handleTileKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openItem(index);
    }
  };

  const setVideoDuration = (src: string | undefined, duration: number) => {
    if (!src || !Number.isFinite(duration) || duration <= 0) return;
    setVideoDurations((current) =>
      current[src] === duration ? current : { ...current, [src]: duration },
    );
  };

  const videoDuration = (item: ViewItem) => (item.src ? videoDurations()[item.src] : undefined);

  const renderPreview = (item: ViewItem, mode: "tile" | "full" | "modal") => {
    if (item.contentType === "image") {
      return (
        <img
          src={item.src}
          alt={item.name}
          class={
            mode === "tile"
              ? "h-full w-full object-cover"
              : mode === "modal"
                ? "max-h-full max-w-full rounded object-contain"
                : "max-h-[70dvh] w-fit max-w-full rounded object-contain"
          }
        />
      );
    }
    if (item.contentType === "video") {
      const video = (
        <video
          src={item.src}
          controls={mode !== "tile"}
          muted={mode === "tile"}
          preload="metadata"
          onLoadedMetadata={(e) => setVideoDuration(item.src, e.currentTarget.duration)}
          class={
            mode === "tile"
              ? "h-full w-full object-cover"
              : mode === "modal"
                ? "max-h-full max-w-full rounded object-contain"
                : "max-h-[70dvh] w-fit max-w-full rounded object-contain"
          }
        />
      );
      return mode === "tile" ? (
        <div class="relative h-full w-full">
          {video}
          <Show when={videoDuration(item)}>
            {(duration) => (
              <span class="bg-bg/80 text-text absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur-sm">
                {formatDuration(duration())}
              </span>
            )}
          </Show>
        </div>
      ) : (
        video
      );
    }
    if (item.contentType === "audio") {
      return mode === "tile" ? (
        <div class="text-muted flex h-full w-full items-center justify-center text-sm">audio</div>
      ) : (
        <audio src={item.src} controls class="w-full" />
      );
    }
    if (item.contentType === "text") {
      return (
        <div
          class={
            mode === "tile"
              ? "text-muted h-full w-full overflow-hidden p-4 text-left font-mono text-xs leading-relaxed whitespace-pre-wrap"
              : "border-border max-h-[70dvh] w-full overflow-auto rounded border p-4 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
          }
        >
          {item.textContent}
        </div>
      );
    }
    return mode === "tile" ? (
      <div class="text-muted flex h-full w-full items-center justify-center text-sm">file</div>
    ) : (
      <div class="flex justify-center py-10">
        <button class={btnClass} style={btnStyle} onClick={() => saveFile(item)}>
          download
        </button>
      </div>
    );
  };

  return (
    <>
      <Show when={stage() === "loading"}>
        <div class="flex justify-center">
          <span class="text-muted text-xs">loading…</span>
        </div>
      </Show>

      <Show when={stage() === "decrypting"}>
        <div class="flex flex-col items-center gap-2" style={fadeIn}>
          <Show when={!decrypting()} fallback={<span class="text-muted text-xs">decrypting…</span>}>
            <span
              class="text-accent font-medium tabular-nums"
              style={{ "font-size": "clamp(1.5rem, 5vw, 2.5rem)" }}
            >
              {progress()}%
            </span>
            <span class="text-muted text-xs">downloading…</span>
          </Show>
        </div>
      </Show>

      <Show when={stage() === "meta"}>
        <div class="flex flex-col items-center gap-3" style={fadeIn}>
          <span class="text-muted" style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}>
            {formatBytes(size())}
          </span>
          <button class={btnClass} style={btnStyle} onClick={handleView}>
            view
          </button>
          <span class="text-muted text-xs">{formatExpiry(expiresAt())} · burns after viewing</span>
        </div>
      </Show>

      <Show when={stage() === "error"}>
        <div class="flex justify-center" style={fadeIn}>
          <span class="text-danger text-sm">{error()}</span>
        </div>
      </Show>

      <Show when={stage() === "content"}>
        <div class="mx-auto flex w-full flex-col gap-4" style={fadeIn}>
          <Show when={items().length > 1}>
            <div
              class="flex items-center justify-between gap-4"
              style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
            >
              <span class="text-text flex min-w-0 gap-1.5">
                <span>{items().length} files</span>
                <span class="text-muted shrink-0 font-medium">{formatBytes(totalPlainSize())}</span>
              </span>
              <button class={ghostClass} onClick={saveAll}>
                save all
              </button>
            </div>
          </Show>

          <Show
            when={items().length > 1}
            fallback={
              <For each={items()}>
                {(item, index) => (
                  <div class="bg-surface border-border flex flex-col items-center gap-3 rounded-lg border p-4">
                    <div
                      class="flex w-full items-center justify-between gap-4"
                      style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
                    >
                      <span class="text-text flex min-w-0 gap-1.5">
                        <span class="truncate">{item.name}</span>
                        <span class="text-muted shrink-0 font-medium">
                          {formatBytes(item.size)}
                        </span>
                      </span>
                      <div class="flex shrink-0 items-center gap-2">
                        <Show when={item.contentType === "text"}>
                          <button
                            class={ghostClass}
                            onClick={() => copyText(index(), item.textContent ?? "")}
                          >
                            {copiedItem() === index() ? "copied!" : "copy"}
                          </button>
                        </Show>
                        <Show when={item.contentType !== "binary"}>
                          <button class={ghostClass} onClick={() => saveFile(item)}>
                            save
                          </button>
                        </Show>
                      </div>
                    </div>

                    {renderPreview(item, "full")}
                  </div>
                )}
              </For>
            }
          >
            <div
              class={`grid grid-cols-2 gap-2 ${items().length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
            >
              <For each={items()}>
                {(item, index) => (
                  <div class="bg-surface border-border overflow-hidden rounded-lg border">
                    <div
                      role="button"
                      tabIndex={0}
                      class="bg-bg focus-visible:ring-accent aspect-4/3 cursor-zoom-in overflow-hidden transition-opacity outline-none hover:opacity-90 focus-visible:ring-2"
                      onClick={() => openItem(index())}
                      onKeyDown={(e) => handleTileKeyDown(e, index())}
                    >
                      {renderPreview(item, "tile")}
                    </div>
                    <div class="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
                      <button
                        type="button"
                        class="text-text min-w-0 truncate border-0 bg-transparent p-0 text-left text-sm font-medium"
                        onClick={() => openItem(index())}
                      >
                        {item.name}
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={selectedItem()} keyed>
            {(item) => (
              <div
                class="bg-bg/95 fixed inset-0 z-50 flex items-center justify-center p-4"
                style={previewClosing() ? fadeOut : fadeIn}
                onClick={closeItem}
              >
                <div
                  class="bg-surface border-border flex max-h-[92dvh] w-full max-w-5xl flex-col gap-4 overflow-auto rounded-lg border p-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div class="flex items-center justify-between gap-4">
                    <span class="text-text flex min-w-0 gap-1.5 text-sm">
                      <span class="truncate">{item.name}</span>
                      <span class="text-muted shrink-0 font-medium">{formatBytes(item.size)}</span>
                    </span>
                    <div class="flex shrink-0 items-center gap-2">
                      <Show when={item.contentType === "text"}>
                        <button
                          class={ghostClass}
                          onClick={() => copyText(selectedIndex() ?? -1, item.textContent ?? "")}
                        >
                          {copiedItem() === selectedIndex() ? "copied!" : "copy"}
                        </button>
                      </Show>
                      <button class={ghostClass} onClick={() => saveFile(item)}>
                        {item.contentType === "binary" ? "download" : "save"}
                      </button>
                      <button
                        type="button"
                        class="text-muted hover:text-accent hover:border-accent border-border rounded border bg-transparent p-1.5 transition-colors"
                        aria-label="close preview"
                        onClick={closeItem}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </div>

                  <div
                    class={`flex min-h-0 items-center justify-center ${
                      item.contentType === "image" || item.contentType === "video"
                        ? "h-[50dvh] max-h-[70dvh]"
                        : ""
                    }`}
                  >
                    {renderPreview(item, "modal")}
                  </div>
                </div>
              </div>
            )}
          </Show>

          <div class="flex items-center justify-between">
            <span class={`text-xs ${burned() ? "text-danger" : "text-muted"}`}>
              {burned() ? "burned" : formatExpiry(expiresAt())}
            </span>
            <a href="/" class={ghostClass}>
              new drop
            </a>
          </div>
        </div>
      </Show>
    </>
  );
}
