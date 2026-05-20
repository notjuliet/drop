import { createSignal, Show, For, onMount, onCleanup, createMemo, createEffect } from "solid-js";

import { generateKey } from "../lib/crypto";
import { prepareFileForUpload } from "../lib/exif";
import { btnClass, btnStyle, fadeIn } from "../lib/ui";
import { formatBytes } from "../lib/utils";

const ghostClass =
  "text-muted hover:text-accent-hover border-none bg-transparent min-w-16 py-1.5 -my-1.5 text-xs";

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

type Status = "idle" | "encrypting" | "uploading";
type View = "result" | "uploading" | "file" | "empty" | "recording";
type UploadResult = {
  fileCount: number;
  totalSize: number;
  url: string;
};

const REC_MIMES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
];
function pickRecMime(): string | null {
  const MR = (window as any).MediaRecorder;
  if (!MR) return null;
  for (const m of REC_MIMES) {
    if (MR.isTypeSupported?.(m)) return m;
  }
  return null;
}
function extForAudio(mimeType: string): string {
  return mimeType.toLowerCase().includes("mp4") ? "m4a" : "webm";
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function CheckBox(props: { checked: boolean }) {
  return (
    <div
      class={`flex size-4 items-center justify-center rounded border transition-colors ${props.checked ? "bg-accent border-accent" : "bg-surface border-border"}`}
    >
      <Show when={props.checked}>
        <svg class="text-bg h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 6l3 3 5-5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Show>
    </div>
  );
}

export default function Upload() {
  const [files, setFiles] = createSignal<File[]>([]);
  const [status, setStatus] = createSignal<Status>("idle");
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal("");
  const [result, setResult] = createSignal<UploadResult | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [burn, setBurn] = createSignal(false);
  const [sensitive, setSensitive] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [maxFileSize, setMaxFileSize] = createSignal(0);
  const [maxTtl, setMaxTtl] = createSignal("");
  const [expiryValue, setExpiryValue] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [recording, setRecording] = createSignal(false);
  const [recSeconds, setRecSeconds] = createSignal(0);
  const [recLevel, setRecLevel] = createSignal(0);
  const [previewUrl, setPreviewUrl] = createSignal("");

  const file = createMemo(() => files()[0] ?? null);
  const selectedCount = createMemo(() => files().length);
  const totalSize = createMemo(() => files().reduce((sum, f) => sum + f.size, 0));
  const resultUrl = createMemo(() => result()?.url ?? "");
  const bundleSize = createMemo(() => {
    const selected = files();
    if (selected.length === 0) return 0;
    const encoder = new TextEncoder();
    const payloadSize =
      selected.length === 1
        ? 10 + encoder.encode(selected[0].name || "file").length + selected[0].size
        : 12 +
          selected.reduce(
            (sum, f) => sum + 10 + encoder.encode(f.name || "file").length + f.size,
            0,
          );
    return Math.ceil(payloadSize / 4096) * 4096 + 16;
  });
  const selectionTooLarge = createMemo(() => {
    const max = maxFileSize();
    return !!max && bundleSize() > max;
  });

  const setFile = (next: File | null) => {
    setFiles(next ? [next] : []);
    if (next) {
      setResult(null);
      setError("");
    }
  };

  const setPickedFiles = (picked: FileList | File[]) => {
    const next = Array.from(picked);
    if (next.length === 0) return;
    setFiles(next);
    setResult(null);
    setError("");
  };

  const previewKind = createMemo<"audio" | "video" | "image" | null>(() => {
    if (selectedCount() !== 1) return null;
    const f = file();
    if (!f) return null;
    if (f.type.startsWith("audio/")) return "audio";
    if (f.type.startsWith("video/")) return "video";
    if (f.type.startsWith("image/")) return "image";
    return null;
  });

  createEffect(() => {
    const f = file();
    const kind = previewKind();
    if (f && kind) {
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);
      onCleanup(() => URL.revokeObjectURL(url));
    } else {
      setPreviewUrl("");
    }
  });

  let fileInput: HTMLInputElement | undefined;
  let activeXhr: XMLHttpRequest | null = null;
  let uploadCancelled = false;
  let worker: Worker | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let recTimer: number | null = null;
  let levelRaf: number | null = null;

  const RADIUS = 130;
  const CENTER = RADIUS + 10;
  const SIZE = CENTER * 2;
  const WAVE_AMP = 3;
  const WAVE_LEN = RADIUS; // one full wave period

  const wavePath = () => {
    const topY = CENTER - RADIUS + 2 * RADIUS * (1 - progress() / 100);
    const left = CENTER - RADIUS - WAVE_LEN;
    const right = CENTER + RADIUS + WAVE_LEN;
    const bottom = CENTER + RADIUS + 2;
    let d = `M ${left} ${bottom} V ${topY}`;
    for (let x = left; x < right; x += WAVE_LEN / 2) {
      const cx = x + WAVE_LEN / 4;
      const ex = x + WAVE_LEN / 2;
      const dir = ((x - left) / (WAVE_LEN / 2)) % 2 === 0 ? -WAVE_AMP : WAVE_AMP;
      d += ` Q ${cx} ${topY + dir} ${ex} ${topY}`;
    }
    d += ` V ${bottom} Z`;
    return d;
  };

  const tooLarge = createMemo(() => {
    return selectionTooLarge();
  });

  const expiryError = createMemo(() => {
    const val = expiryValue().trim();
    const max = maxTtl();
    if (!val) return "";
    const valSec = parseDuration(val);
    if (valSec === undefined) return "try 30m, 24h, or 7d";
    if (!max) return "";
    const maxSec = parseDuration(max);
    if (maxSec === undefined) return "";
    return valSec > maxSec ? `max expiry ${max}` : "";
  });

  const view = createMemo<View>(() => {
    if (resultUrl()) return "result";
    if (status() !== "idle") return "uploading";
    if (recording()) return "recording";
    if (selectedCount() > 0) return "file";
    return "empty";
  });

  const canRecord = !!pickRecMime() && !!navigator.mediaDevices?.getUserMedia;

  const stopRecStream = () => {
    if (recTimer !== null) {
      clearInterval(recTimer);
      recTimer = null;
    }
    if (levelRaf !== null) {
      cancelAnimationFrame(levelRaf);
      levelRaf = null;
    }
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;
    setRecLevel(0);
  };

  const startRecording = async () => {
    const pickedMime = pickRecMime();
    if (pickedMime === null) {
      setError("recording not supported in this browser");
      return;
    }
    setError("");
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("microphone permission denied");
      return;
    }

    try {
      audioCtx = new AudioContext();
      const src = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;
      const tick = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const target = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        const k = target > smoothed ? 0.25 : 0.08;
        smoothed += (target - smoothed) * k;
        setRecLevel(smoothed);
        levelRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}

    const chunks: BlobPart[] = [];
    const mr = new MediaRecorder(mediaStream, { mimeType: pickedMime });
    mediaRecorder = mr;
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => {
      const actualMime = mr.mimeType || pickedMime;
      const baseType = actualMime.split(";")[0];
      const ext = extForAudio(actualMime);
      const blob = new Blob(chunks, { type: baseType });
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const f = new File([blob], `recording-${ts}.${ext}`, { type: baseType });
      setFile(f);
      stopRecStream();
      setRecording(false);
    };
    mr.start();
    setRecSeconds(0);
    setRecording(true);
    recTimer = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
  };

  const stopRecording = () => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
    }
  };

  const cancelRecording = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.onstop = null as any;
      mediaRecorder.stop();
    }
    stopRecStream();
    setRecording(false);
    setRecSeconds(0);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    if (e.relatedTarget === null || !document.body.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files.length) setPickedFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: ClipboardEvent) => {
    if (view() !== "empty") return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const pastedFiles = e.clipboardData?.files;
    if (pastedFiles?.length) {
      e.preventDefault();
      setPickedFiles(pastedFiles);
    }
  };

  onMount(async () => {
    worker = new Worker(new URL("../lib/crypto.worker.ts", import.meta.url), {
      type: "module",
    });
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("paste", handlePaste);

    try {
      const res = await fetch("/api/info");
      if (res.ok) {
        const info = await res.json();
        setMaxFileSize(info.maxFileSize);
        if (info.maxTtl) {
          setMaxTtl(info.maxTtl);
          setExpiryValue(info.maxTtl);
        }
      }
    } catch {}
    setLoading(false);
  });

  onCleanup(() => {
    document.removeEventListener("dragover", handleDragOver);
    document.removeEventListener("dragleave", handleDragLeave);
    document.removeEventListener("drop", handleDrop);
    document.removeEventListener("paste", handlePaste);
    worker?.terminate();
    cancelRecording();
  });

  const removeFile = () => {
    setFiles([]);
    setError("");
    if (fileInput) fileInput.value = "";
  };

  const cancelUpload = () => {
    uploadCancelled = true;
    if (activeXhr) {
      activeXhr.abort();
      activeXhr = null;
    }
    setStatus("idle");
    setProgress(0);
    removeFile();
  };

  const handleUpload = async () => {
    const selectedFiles = files();
    if (selectedFiles.length === 0) return;

    setStatus("encrypting");
    setError("");
    setResult(null);
    setProgress(0);
    uploadCancelled = false;

    try {
      const { encoded } = await generateKey();
      const fileBuffers: { fileName: string; fileBuffer: ArrayBuffer }[] = [];

      for (const [index, f] of selectedFiles.entries()) {
        fileBuffers.push(await prepareFileForUpload(f, index));
        if (uploadCancelled) throw new Error("Upload cancelled");
      }

      const ciphertext = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
        worker!.onmessage = (e) => {
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.ciphertext);
        };
        worker!.postMessage(
          {
            type: "encryptFiles",
            files: fileBuffers,
            keyEncoded: encoded,
          },
          fileBuffers.map((f) => f.fileBuffer),
        );
      });
      if (uploadCancelled) throw new Error("Upload cancelled");

      const formData = new FormData();
      formData.append("file", new Blob([ciphertext]));
      formData.append("expiresIn", expiryValue().trim() || maxTtl());
      formData.append("burnAfterRead", burn() ? "true" : "false");

      setStatus("uploading");

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
        xhr.onabort = () => reject(new Error("Upload cancelled"));
        xhr.send(formData);
      });

      setResult({
        fileCount: selectedFiles.length,
        totalSize: totalSize(),
        url: `${location.origin}/${res.id}#${encoded}${sensitive() ? "&nsfw=true" : ""}`,
      });
      removeFile();
    } catch (e: any) {
      if (!uploadCancelled) setError(e.message);
    } finally {
      activeXhr = null;
      setStatus("idle");
      setProgress(0);
    }
  };

  const copyLink = (e: MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(resultUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  createEffect(() => {
    document.title = status() === "uploading" ? `${progress()}% — drop` : "drop";
  });

  return (
    <>
      <div
        class="group relative mx-auto flex aspect-square w-[90vw] max-w-125 items-center justify-center sm:w-[80vw]"
        onClick={() => view() === "empty" && fileInput?.click()}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} class="absolute inset-0 h-full w-full">
          <defs>
            <clipPath id="circle-clip">
              <circle cx={CENTER} cy={CENTER} r={RADIUS} />
            </clipPath>
          </defs>
          <style>{`@keyframes wave { from { transform: translateX(0) } to { transform: translateX(-${WAVE_LEN}px) } }`}</style>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={
              tooLarge()
                ? "var(--color-danger)"
                : dragging() || view() === "result"
                  ? "var(--color-accent)"
                  : "var(--color-border)"
            }
            stroke-width="5"
            pathLength={dragging() ? "100" : undefined}
            stroke-dasharray={dragging() ? "3 2" : "none"}
            class="transition-all duration-200"
          />
          <Show when={view() === "recording"}>
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="var(--color-accent)"
              fill-opacity={recLevel() * 0.22}
              stroke="var(--color-accent)"
              stroke-width="5"
              opacity={recLevel() > 0.05 ? Math.min(1, recLevel() * 1.5) : 0}
              style={{
                transition: "opacity 120ms linear, fill-opacity 120ms linear",
              }}
            />
          </Show>
          {/* Upload liquid fill */}
          <Show when={status() === "uploading"}>
            <g clip-path="url(#circle-clip)">
              <path
                d={wavePath()}
                fill="var(--color-border)"
                style={{
                  transition: "d 300ms ease-out",
                  animation: `wave 2s linear infinite`,
                }}
              />
            </g>
          </Show>
        </svg>

        <div class="z-10 flex flex-col items-center text-center">
          <Show when={loading()}>
            <span class="text-muted text-xs">loading…</span>
          </Show>
          <Show when={!loading()}>
            <Show when={view() === "result"}>
              <div class="flex flex-col items-center gap-3" style={fadeIn}>
                <span class="text-muted" style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}>
                  {(result()?.fileCount ?? 0) > 1
                    ? `${result()!.fileCount} files expire in ${expiryValue()}`
                    : `expires in ${expiryValue()}`}
                </span>
                <button class={btnClass} style={btnStyle} onClick={copyLink}>
                  {copied() ? "copied!" : "copy link"}
                </button>
              </div>
            </Show>

            <Show when={view() === "uploading"}>
              <div class="flex flex-col items-center gap-3" style={fadeIn}>
                <Show when={status() === "uploading"}>
                  <span
                    class="text-accent font-medium tabular-nums"
                    style={{ "font-size": "clamp(1.5rem, 5vw, 2.5rem)" }}
                  >
                    {progress()}%
                  </span>
                </Show>
                <span class="text-muted text-[10px] sm:text-xs">
                  {status() === "encrypting" ? "encrypting\u2026" : "uploading\u2026"}
                </span>
                <button
                  class={ghostClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelUpload();
                  }}
                >
                  cancel
                </button>
              </div>
            </Show>

            <Show when={view() === "file"}>
              <div class="flex flex-col items-center gap-4" style={fadeIn}>
                <Show when={previewUrl() && previewKind() === "audio"}>
                  <audio
                    src={previewUrl()}
                    controls
                    onClick={(e) => e.stopPropagation()}
                    style={{ "max-width": "min(80vw, 260px)", width: "260px" }}
                  />
                </Show>
                <Show when={previewUrl() && previewKind() === "image"}>
                  <img
                    src={previewUrl()}
                    onClick={(e) => e.stopPropagation()}
                    class="max-h-28 rounded object-contain sm:max-h-40"
                    style={{ "max-width": "min(55vw, 260px)" }}
                  />
                </Show>
                <Show when={previewUrl() && previewKind() === "video"}>
                  <video
                    src={previewUrl()}
                    controls
                    onClick={(e) => e.stopPropagation()}
                    class="max-h-28 rounded sm:max-h-40"
                    style={{ "max-width": "min(55vw, 260px)" }}
                  />
                </Show>
                <div class="flex flex-col items-center gap-2">
                  <Show
                    when={selectedCount() === 1}
                    fallback={
                      <div
                        class="flex w-full flex-col items-center gap-2"
                        style={{ "max-width": "clamp(170px, 48vw, 320px)" }}
                      >
                        <span
                          class="text-text flex gap-1.5"
                          style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
                        >
                          <span>{selectedCount()} files</span>
                          <span
                            class={`shrink-0 font-medium ${tooLarge() ? "text-danger" : "text-muted"}`}
                          >
                            {tooLarge()
                              ? `${formatBytes(bundleSize())} / ${formatBytes(maxFileSize())}`
                              : formatBytes(totalSize())}
                          </span>
                        </span>
                        <div
                          class="w-full overflow-auto pr-1 text-left"
                          style={{ "max-height": "5.25rem" }}
                        >
                          <For each={files()}>
                            {(f) => (
                              <div class="flex items-center gap-2 text-[10px] leading-5 sm:text-xs">
                                <span class="text-text min-w-0 flex-1 truncate">
                                  {f.name || "file"}
                                </span>
                                <span
                                  class={`shrink-0 font-medium ${maxFileSize() && f.size > maxFileSize() ? "text-danger" : "text-muted"}`}
                                >
                                  {formatBytes(f.size)}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    }
                  >
                    <span
                      class="text-text flex gap-1.5 truncate"
                      style={{ "max-width": "clamp(120px, 40vw, 300px)" }}
                    >
                      <span class="truncate" style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}>
                        {file()!.name}
                      </span>
                      <span
                        class={`shrink-0 font-medium ${tooLarge() ? "text-danger" : "text-muted"}`}
                        style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
                      >
                        {tooLarge()
                          ? `${formatBytes(bundleSize())} / ${formatBytes(maxFileSize())}`
                          : formatBytes(file()!.size)}
                      </span>
                    </span>
                  </Show>
                  <div class="flex flex-col items-center gap-1 text-xs sm:text-sm">
                    <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                      <span class="relative inline-flex justify-center">
                        <input
                          type="text"
                          aria-label="expiry"
                          aria-describedby={expiryError() ? "expiry-error" : undefined}
                          aria-invalid={!!expiryError()}
                          value={expiryValue()}
                          placeholder={maxTtl() || "7d"}
                          onInput={(e) => setExpiryValue(e.currentTarget.value)}
                          onClick={(e) => e.stopPropagation()}
                          class={`text-accent w-14 border-b bg-transparent text-center font-medium transition-colors outline-none ${expiryError() ? "border-danger" : "border-border focus:border-accent"}`}
                        />
                        <Show when={expiryError()}>
                          <span
                            id="expiry-error"
                            role="tooltip"
                            class="bg-bg text-danger border-danger/30 absolute top-full left-1/2 z-10 mt-2 w-max max-w-36 -translate-x-1/2 rounded border px-2 py-1 text-center text-[10px] leading-tight shadow-sm sm:text-xs"
                          >
                            {expiryError()}
                          </span>
                        </Show>
                      </span>
                      <button
                        class={`flex items-center gap-1.5 transition-colors select-none ${burn() ? "text-accent" : "text-muted hover:text-accent-hover"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setBurn((b) => !b);
                        }}
                      >
                        <CheckBox checked={burn()} />
                        burn
                      </button>
                      <button
                        class={`flex items-center gap-1.5 transition-colors select-none ${sensitive() ? "text-accent" : "text-muted hover:text-accent-hover"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSensitive((s) => !s);
                        }}
                      >
                        <CheckBox checked={sensitive()} />
                        nsfw
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  class={`${btnClass} disabled:cursor-not-allowed disabled:opacity-40`}
                  style={btnStyle}
                  disabled={tooLarge() || !!expiryError()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpload();
                  }}
                >
                  upload
                </button>
              </div>
            </Show>

            <Show when={view() === "recording"}>
              <div class="flex flex-col items-center gap-3" style={fadeIn}>
                <span
                  class="text-accent font-medium tabular-nums"
                  style={{ "font-size": "clamp(1.5rem, 5vw, 2.5rem)" }}
                >
                  {formatTime(recSeconds())}
                </span>
                <span class="text-muted text-[10px] sm:text-xs">recording…</span>
                <button
                  class={btnClass}
                  style={btnStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    stopRecording();
                  }}
                >
                  stop
                </button>
                <button
                  class={ghostClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelRecording();
                  }}
                >
                  cancel
                </button>
              </div>
            </Show>

            <Show when={view() === "empty"}>
              <div class="flex flex-col items-center gap-3" style={fadeIn}>
                <span
                  class="text-muted font-medium"
                  style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
                >
                  drop files, or
                </span>
                <button
                  class={btnClass}
                  style={btnStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInput?.click();
                  }}
                >
                  browse
                </button>
                <Show when={canRecord}>
                  <button
                    class="text-muted hover:text-accent-hover flex items-center gap-2 border-none bg-transparent py-1 transition-colors"
                    style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      startRecording();
                    }}
                    aria-label="record audio"
                  >
                    <span class="bg-danger inline-block size-2.5 rounded-full" />
                    record
                  </button>
                </Show>
                <Show when={maxFileSize()}>
                  <span class="text-muted text-[10px] sm:text-xs">
                    up to {formatBytes(maxFileSize())}
                  </span>
                </Show>
              </div>
            </Show>
          </Show>
        </div>

        <input
          type="file"
          ref={(el) => {
            fileInput = el;
          }}
          class="hidden"
          multiple
          onChange={() => {
            if (fileInput?.files?.length) setPickedFiles(fileInput.files);
          }}
        />
      </div>

      <Show when={view() === "file" || view() === "result"}>
        <div class="mt-4 flex justify-center" style={fadeIn}>
          <button
            class={ghostClass}
            onClick={() => {
              setResult(null);
              removeFile();
            }}
          >
            new drop
          </button>
        </div>
      </Show>

      <Show when={error()}>
        <div class="text-danger mt-4 text-center text-xs">{error()}</div>
      </Show>
    </>
  );
}
