import { createSignal, Show, onMount, onCleanup } from "solid-js";

import { importKey } from "../lib/crypto";
import { btnClass, btnStyle, fadeIn } from "../lib/ui";
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
    v.onerror = () => finish(false);
    setTimeout(() => finish(false), 2000);
    v.src = url;
  });
}

type Stage = "loading" | "meta" | "decrypting" | "content" | "error";
type ContentType = "text" | "image" | "video" | "audio" | "binary";

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

  const [contentType, setContentType] = createSignal<ContentType>("binary");
  const [textContent, setTextContent] = createSignal("");
  const [imageSrc, setImageSrc] = createSignal("");
  const [mediaSrc, setMediaSrc] = createSignal("");
  const [fileName, setFileName] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  let decryptedBlob: Blob | null = null;
  const worker = new Worker(new URL("../lib/crypto.worker.ts", import.meta.url), {
    type: "module",
  });

  onCleanup(() => worker.terminate());

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

      const { fileName: name, fileData } = await new Promise<{
        fileName: string;
        fileData: Uint8Array<ArrayBuffer>;
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

      const ext = getExt(name);
      setFileName(name);

      if (burnAfterRead()) setBurned(true);

      const mime = IMAGE_MIME[ext] || VIDEO_MIME[ext] || AUDIO_MIME[ext] || undefined;
      if (mime) {
        const blob = new Blob([fileData], { type: mime });
        decryptedBlob = blob;
        const url = URL.createObjectURL(blob);
        if (IMAGE_EXTS.has(ext)) {
          setImageSrc(url);
          setContentType("image");
        } else if (VIDEO_EXTS.has(ext)) {
          setMediaSrc(url);
          if (ext === "webm" && (await isAudioOnlyWebm(url))) {
            setContentType("audio");
          } else {
            setContentType("video");
          }
        } else {
          setMediaSrc(url);
          setContentType("audio");
        }
      } else if (TEXT_EXTS.has(ext)) {
        setTextContent(new TextDecoder().decode(fileData));
        setContentType("text");
      } else {
        decryptedBlob = new Blob([fileData]);
        setContentType("binary");
      }

      setStage("content");
    } catch (e: any) {
      setError(e.message || "Failed to decrypt.");
      setStage("error");
    }
  };

  const copyText = () => {
    navigator.clipboard.writeText(textContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveFile = () => {
    if (contentType() === "text") {
      const blob = new Blob([textContent()], { type: "text/plain" });
      triggerDownload(blob, fileName());
    } else if (decryptedBlob) {
      triggerDownload(decryptedBlob, fileName());
    }
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
          <div
            class="flex items-center justify-between gap-4"
            style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
          >
            <span class="text-text flex min-w-0 gap-1.5">
              <span class="truncate">{fileName()}</span>
              <span class="text-muted shrink-0 font-medium">{formatBytes(size())}</span>
            </span>
            <div class="flex shrink-0 items-center gap-2">
              <Show when={contentType() === "text"}>
                <button class={ghostClass} onClick={copyText}>
                  {copied() ? "copied!" : "copy"}
                </button>
              </Show>
              <Show when={contentType() !== "binary"}>
                <button class={ghostClass} onClick={saveFile}>
                  save
                </button>
              </Show>
            </div>
          </div>

          <Show when={contentType() === "image"}>
            <div class="bg-surface border-border flex items-center justify-center rounded-lg border p-4">
              <img
                src={imageSrc()}
                alt={fileName()}
                class="max-h-[70vh] w-fit max-w-full rounded object-contain"
              />
            </div>
          </Show>
          <Show when={contentType() === "video"}>
            <div class="bg-surface border-border flex items-center justify-center rounded-lg border p-4">
              <video
                src={mediaSrc()}
                controls
                class="max-h-[70vh] w-fit max-w-full rounded object-contain"
              />
            </div>
          </Show>
          <Show when={contentType() === "audio"}>
            <div class="bg-surface border-border rounded-lg border p-4">
              <audio src={mediaSrc()} controls class="w-full" />
            </div>
          </Show>
          <Show when={contentType() === "text"}>
            <div class="bg-surface border-border max-h-[70vh] w-full overflow-auto rounded-lg border p-4 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
              {textContent()}
            </div>
          </Show>
          <Show when={contentType() === "binary"}>
            <div class="flex justify-center">
              <button class={btnClass} style={btnStyle} onClick={saveFile}>
                download
              </button>
            </div>
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
