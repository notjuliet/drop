import { createSignal, Show, onMount, onCleanup, createMemo } from "solid-js";

import { generateKey, encrypt } from "../lib/crypto";
import { formatBytes } from "../lib/utils";

const btnClass =
  "bg-accent hover:bg-accent-hover rounded-md border-none px-4 py-1.5 font-medium text-white transition-colors";
const btnStyle = { "font-size": "clamp(1rem, 3vw, 1.5rem)" };
const ghostClass =
  "text-muted hover:text-text border-none bg-transparent p-0 text-xs";

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
type View = "result" | "uploading" | "file" | "empty";

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

  let fileInput!: HTMLInputElement;
  let activeXhr: XMLHttpRequest | null = null;

  const RADIUS = 130;
  const CENTER = RADIUS + 10;
  const SIZE = CENTER * 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const WAVE_AMP = 3;
  const WAVE_LEN = RADIUS; // one full wave period

  const wavePath = () => {
    const topY = CENTER - RADIUS + 2 * RADIUS * (1 - progress() / 100);
    const left = CENTER - RADIUS - WAVE_LEN;
    const right = CENTER + RADIUS + WAVE_LEN;
    const bottom = CENTER + RADIUS;
    let d = `M ${left} ${bottom} V ${topY}`;
    for (let x = left; x < right; x += WAVE_LEN / 2) {
      const cx = x + WAVE_LEN / 4;
      const ex = x + WAVE_LEN / 2;
      const dir =
        ((x - left) / (WAVE_LEN / 2)) % 2 === 0 ? -WAVE_AMP : WAVE_AMP;
      d += ` Q ${cx} ${topY + dir} ${ex} ${topY}`;
    }
    d += ` V ${bottom} Z`;
    return d;
  };

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
    if (file()) return "file";
    return "empty";
  });

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
        if (info.maxTtl) {
          setMaxTtl(info.maxTtl);
          setExpiryValue(info.maxTtl);
        }
      }
    } catch {}
  });

  onCleanup(() => {
    document.removeEventListener("dragover", handleDragOver);
    document.removeEventListener("dragleave", handleDragLeave);
    document.removeEventListener("drop", handleDrop);
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
      const { key, encoded } = await generateKey();
      const buffer = await f.arrayBuffer();
      const ciphertext = await encrypt(f.name || "file", buffer, key);

      const formData = new FormData();
      formData.append("file", new Blob([ciphertext]));
      formData.append("expiresIn", expiryValue().trim());
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

      const url = `${location.origin}/p/${res.id}#${encoded}`;
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

  return (
    <>
      <div
        class="group relative mx-auto flex aspect-square w-[80vw] max-w-125 items-center justify-center"
        onClick={() => view() === "empty" && fileInput.click()}
      >
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          class="absolute inset-0 h-full w-full"
        >
          <defs>
            <clipPath id="circle-clip">
              <circle cx={CENTER} cy={CENTER} r={RADIUS - 3.5} />
            </clipPath>
          </defs>
          <style>{`@keyframes wave { from { transform: translateX(0) } to { transform: translateX(-${WAVE_LEN}px) } }`}</style>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={dragging() ? "var(--color-accent)" : "var(--color-border)"}
            stroke-width="7"
            pathLength={dragging() ? "100" : undefined}
            stroke-dasharray={dragging() ? "3 2" : "none"}
            class="transition-all duration-200"
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={tooLarge() ? "var(--color-danger)" : "var(--color-accent)"}
            stroke-width="7"
            stroke-dasharray={`${CIRCUMFERENCE}`}
            stroke-dashoffset={`${CIRCUMFERENCE * (1 - (status() !== "idle" || dragging() ? 0 : sizeRatio()))}`}
            stroke-linecap="round"
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{
              transition: dragging()
                ? "none"
                : `all ${animDuration()}ms ease-out`,
            }}
          />
          {/* Upload liquid fill */}
          <g clip-path="url(#circle-clip)">
            <path
              d={wavePath()}
              fill="var(--color-accent)"
              opacity="0.15"
              style={{
                transition: "d 300ms ease-out",
                animation:
                  status() === "uploading" ? `wave 2s linear infinite` : "none",
              }}
            />
          </g>
        </svg>

        <div class="z-10 flex flex-col items-center gap-2 text-center sm:gap-3">
          <Show when={view() === "result"}>
            <span
              class="text-muted"
              style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
            >
              expires in {expiryValue()}
            </span>
            <button class={btnClass} style={btnStyle} onClick={copyLink}>
              {copied() ? "copied!" : "copy link"}
            </button>
            <button
              class={ghostClass}
              onClick={(e) => {
                e.stopPropagation();
                setResultUrl("");
                removeFile();
              }}
            >
              new drop
            </button>
          </Show>

          <Show when={view() === "uploading"}>
            <span
              class="text-accent font-medium tabular-nums"
              style={{ "font-size": "clamp(1.5rem, 5vw, 2.5rem)" }}
            >
              {progress()}%
            </span>
            <span class="text-muted text-xs">
              {status() === "encrypting"
                ? "encrypting\u2026"
                : "uploading\u2026"}
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
          </Show>

          <Show when={view() === "file"}>
            <span
              class="text-text flex gap-1.5 truncate"
              style={{ "max-width": "clamp(120px, 40vw, 300px)" }}
            >
              <span
                class="truncate"
                style={{ "font-size": "clamp(0.75rem, 2vw, 1rem)" }}
              >
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
            <button
              class={`${btnClass} disabled:cursor-not-allowed disabled:opacity-40`}
              style={btnStyle}
              disabled={tooLarge()}
              onClick={(e) => {
                e.stopPropagation();
                handleUpload();
              }}
            >
              upload
            </button>
            <button
              class={ghostClass}
              onClick={(e) => {
                e.stopPropagation();
                removeFile();
              }}
            >
              remove
            </button>
          </Show>

          <Show when={view() === "empty"}>
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
            <Show when={maxFileSize()}>
              <span class="text-muted text-xs">
                up to {formatBytes(maxFileSize())}
              </span>
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

      <Show when={view() !== "result"}>
        <div class="mx-auto mt-6 flex w-fit flex-col gap-4 text-sm">
          <label class="text-muted flex items-center gap-3 select-none">
            lifetime
            <input
              type="text"
              value={expiryValue()}
              placeholder="30m, 24h, 7d"
              onInput={(e) => setExpiryValue(e.currentTarget.value)}
              class={`bg-surface text-accent w-28 rounded-md border px-2 py-1 text-center font-medium transition-colors outline-none ${expiryTooLong() ? "border-danger" : "border-border focus:border-accent"}`}
            />
          </label>
          <label
            class="text-muted flex items-center gap-3 select-none"
            onClick={() => setBurn((b) => !b)}
          >
            burn after read
            <div
              class={`flex size-5 items-center justify-center rounded border transition-colors ${burn() ? "bg-accent border-accent" : "bg-surface border-border"}`}
            >
              <Show when={burn()}>
                <svg
                  class="text-bg h-3.5 w-3.5"
                  viewBox="0 0 12 12"
                  fill="none"
                >
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
          </label>
        </div>
      </Show>

      <Show when={error()}>
        <div class="text-danger mt-4 text-xs">{error()}</div>
      </Show>
    </>
  );
}
