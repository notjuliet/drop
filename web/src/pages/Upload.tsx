import { createSignal, Show, onMount, onCleanup } from "solid-js";

import { generateKey, encrypt } from "../lib/crypto";
import { formatBytes } from "../lib/utils";

export default function Upload() {
  const [file, setFile] = createSignal<File | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal("");
  const [resultUrl, setResultUrl] = createSignal("");
  const [buttonText, setButtonText] = createSignal("Upload");
  const [dragging, setDragging] = createSignal(false);

  let fileInput!: HTMLInputElement;
  let linkInput!: HTMLInputElement;

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

  onMount(() => {
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
  });

  onCleanup(() => {
    document.removeEventListener("dragover", handleDragOver);
    document.removeEventListener("dragleave", handleDragLeave);
    document.removeEventListener("drop", handleDrop);
  });

  const removeFile = () => {
    setFile(null);
    fileInput.value = "";
  };

  const handleUpload = async () => {
    const f = file();
    if (!f) return;

    setUploading(true);
    setButtonText("Encrypting\u2026");
    setError("");
    setResultUrl("");
    setProgress(0);

    try {
      const { key, encoded } = await generateKey();
      const buffer = await f.arrayBuffer();
      const ciphertext = await encrypt(f.name || "file", buffer, key);

      const formData = new FormData();
      formData.append("file", new Blob([ciphertext]));
      formData.append(
        "expiresIn",
        (document.getElementById("expiry") as HTMLInputElement).value.trim(),
      );
      formData.append(
        "burnAfterRead",
        (document.getElementById("burn") as HTMLInputElement).checked
          ? "true"
          : "false",
      );

      setButtonText("Uploading\u2026");

      const res = await new Promise<{ id: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/file");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setProgress(pct);
            setButtonText(`Uploading\u2026 ${pct}%`);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      setButtonText("Upload");
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(linkInput.value);
    const btn = document.getElementById("copy-btn")!;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  };

  return (
    <>
      <div
        class="bg-surface border-border hover:border-accent flex h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-colors"
        classList={{ "border-accent bg-accent-subtle": dragging() }}
        onClick={() => fileInput.click()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          class="text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p class="text-muted text-sm">
          Drop a file or{" "}
          <button
            class="text-accent cursor-pointer border-none bg-transparent p-0 text-sm underline"
            onClick={(e) => {
              e.stopPropagation();
              fileInput.click();
            }}
          >
            browse
          </button>
        </p>
        <input
          type="file"
          ref={fileInput!}
          class="hidden"
          onChange={() => {
            if (fileInput.files?.[0]) setFile(fileInput.files[0]);
          }}
        />
      </div>

      <Show when={file()}>
        <div class="mt-3 flex items-center gap-2">
          <span class="bg-surface border-border text-text inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs">
            {file()!.name} ({formatBytes(file()!.size)})
          </span>
          <button
            class="text-muted hover:text-text cursor-pointer border-none bg-transparent p-0 text-sm leading-none"
            onClick={removeFile}
          >
            &times;
          </button>
        </div>
      </Show>

      <div class="mt-4 flex items-center gap-4">
        <input
          id="expiry"
          type="text"
          value="24h"
          placeholder="e.g. 30m, 24h, 7d"
          class="bg-surface border-border text-text focus:border-accent w-24 rounded-md border px-2.5 py-1.5 text-xs transition-colors outline-none"
        />
        <label class="text-muted flex cursor-pointer items-center gap-1.5 text-xs select-none">
          <input type="checkbox" id="burn" class="accent-accent" />
          Burn after read
        </label>
      </div>

      <button
        class="bg-accent hover:bg-accent-hover relative mt-4 w-full cursor-pointer overflow-hidden rounded-md border-none py-2.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!file() || uploading()}
        onClick={handleUpload}
      >
        {buttonText()}
      </button>

      <Show when={uploading()}>
        <div class="bg-surface mt-2 h-1 w-full overflow-hidden rounded-full">
          <div
            class="bg-accent h-full rounded-full transition-all duration-150"
            style={{ width: `${progress()}%` }}
          />
        </div>
      </Show>

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
              id="copy-btn"
              class="bg-accent hover:bg-accent-hover shrink-0 cursor-pointer rounded-md border-none px-3 py-1.5 text-xs font-medium text-white transition-colors"
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
