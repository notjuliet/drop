import { createSignal, Show, onMount, onCleanup, createMemo, createEffect } from "solid-js";

import { generateKey } from "../lib/crypto";
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
  const n = parseInt(s);
  const mult = DURATION_UNITS[s.trim().slice(-1)];
  if (isNaN(n) || mult === undefined) return undefined;
  return n * mult;
}

type Status = "idle" | "encrypting" | "uploading";
type View = "result" | "uploading" | "file" | "empty" | "recording";

const REC_MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
function pickRecMime(): string | null {
  const MR = (window as any).MediaRecorder;
  if (!MR) return null;
  for (const m of REC_MIMES) {
    if (MR.isTypeSupported?.(m)) return m;
  }
  return "";
}
function extForAudio(mimeType: string): string {
  const base = mimeType.split(";")[0].toLowerCase();
  if (base.includes("mp4") || base.includes("aac") || base.includes("mpeg")) return "m4a";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("wav")) return "wav";
  return "webm";
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function Upload() {
  const [file, setFile] = createSignal<File | null>(null);
  const [status, setStatus] = createSignal<Status>("idle");
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal("");
  const [resultUrl, setResultUrl] = createSignal("");
  const [dragging, setDragging] = createSignal(false);
  const [burn, setBurn] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [maxFileSize, setMaxFileSize] = createSignal(0);
  const [maxTtl, setMaxTtl] = createSignal("");
  const [expiryValue, setExpiryValue] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [recording, setRecording] = createSignal(false);
  const [recSeconds, setRecSeconds] = createSignal(0);
  const [recLevel, setRecLevel] = createSignal(0);
  const [previewUrl, setPreviewUrl] = createSignal("");

  const previewKind = createMemo<"audio" | "video" | "image" | null>(() => {
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

  let fileInput!: HTMLInputElement;
  let activeXhr: XMLHttpRequest | null = null;
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
    const f = file();
    const max = maxFileSize();
    return !!f && !!max && f.size > max;
  });

  const expiryTooLong = createMemo(() => {
    const val = expiryValue();
    const max = maxTtl();
    if (!val || !max) return false;
    const valSec = parseDuration(val);
    const maxSec = parseDuration(max);
    if (valSec === undefined || maxSec === undefined) return false;
    return valSec > maxSec;
  });

  const view = createMemo<View>(() => {
    if (resultUrl()) return "result";
    if (status() !== "idle") return "uploading";
    if (recording()) return "recording";
    if (file()) return "file";
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
    const mr = new MediaRecorder(mediaStream, pickedMime ? { mimeType: pickedMime } : undefined);
    mediaRecorder = mr;
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => {
      const actualMime = mr.mimeType || pickedMime || "audio/webm";
      const baseType = actualMime.split(";")[0] || "audio/webm";
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
    mediaRecorder?.state === "recording" && mediaRecorder.stop();
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
    if (e.dataTransfer?.files[0]) setFile(e.dataTransfer.files[0]);
  };

  onMount(async () => {
    worker = new Worker(new URL("../lib/crypto.worker.ts", import.meta.url), {
      type: "module",
    });
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);

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
    worker?.terminate();
    cancelRecording();
  });

  const removeFile = () => {
    setFile(null);
    setError("");
    fileInput.value = "";
  };

  const cancelUpload = () => {
    if (activeXhr) {
      activeXhr.abort();
      activeXhr = null;
    }
    setStatus("idle");
    setProgress(0);
    removeFile();
  };

  const handleUpload = async () => {
    const f = file();
    if (!f) return;

    setStatus("encrypting");
    setError("");
    setResultUrl("");
    setProgress(0);

    try {
      const { encoded } = await generateKey();
      const buffer = await f.arrayBuffer();
      const ciphertext = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
        worker!.onmessage = (e) => {
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.ciphertext);
        };
        worker!.postMessage(
          {
            type: "encrypt",
            fileName: f.name || "file",
            fileBuffer: buffer,
            keyEncoded: encoded,
          },
          [buffer],
        );
      });

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
        xhr.send(formData);
      });

      const url = `${location.origin}/${res.id}#${encoded}`;
      setResultUrl(url);
      removeFile();
    } catch (e: any) {
      setError(e.message);
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
        onClick={() => view() === "empty" && fileInput.click()}
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
                  expires in {expiryValue()}
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
                        ? `${formatBytes(file()!.size)} / ${formatBytes(maxFileSize())}`
                        : formatBytes(file()!.size)}
                    </span>
                  </span>
                  <div class="flex items-center gap-4 text-xs sm:text-sm">
                    <input
                      type="text"
                      value={expiryValue()}
                      placeholder={maxTtl() || "7d"}
                      onInput={(e) => setExpiryValue(e.currentTarget.value)}
                      onClick={(e) => e.stopPropagation()}
                      class={`text-accent w-14 border-b bg-transparent text-center font-medium transition-colors outline-none ${expiryTooLong() ? "border-danger" : "border-border focus:border-accent"}`}
                    />
                    <button
                      class={`flex items-center gap-1.5 transition-colors select-none ${burn() ? "text-accent" : "text-muted hover:text-accent-hover"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setBurn((b) => !b);
                      }}
                    >
                      <div
                        class={`flex size-4 items-center justify-center rounded border transition-colors ${burn() ? "bg-accent border-accent" : "bg-surface border-border"}`}
                      >
                        <Show when={burn()}>
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
                      burn
                    </button>
                  </div>
                </div>
                <button
                  class={`${btnClass} disabled:cursor-not-allowed disabled:opacity-40`}
                  style={btnStyle}
                  disabled={tooLarge() || expiryTooLong()}
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
                  drop a file, or
                </span>
                <button
                  class={btnClass}
                  style={btnStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInput.click();
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
          ref={fileInput!}
          class="hidden"
          onChange={() => {
            if (fileInput.files?.[0]) setFile(fileInput.files[0]);
          }}
        />
      </div>

      <Show when={view() === "file" || view() === "result"}>
        <div class="mt-4 flex justify-center" style={fadeIn}>
          <button
            class={ghostClass}
            onClick={() => {
              setResultUrl("");
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
