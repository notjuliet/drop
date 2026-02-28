import { useParams } from "@solidjs/router";
import { createSignal, Show, Switch, Match, onMount } from "solid-js";

import { importKey, decrypt } from "../lib/crypto";
import {
  formatBytes,
  formatExpiry,
  getExt,
  triggerDownload,
  IMAGE_EXTS,
  TEXT_EXTS,
  IMAGE_MIME,
} from "../lib/utils";

type Stage = "loading" | "meta" | "content" | "error";
type ContentType = "text" | "image" | "binary";

export default function View() {
  const params = useParams();

  const [stage, setStage] = createSignal<Stage>("loading");
  const [error, setError] = createSignal("");
  const [size, setSize] = createSignal(0);
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [burnAfterRead, setBurnAfterRead] = createSignal(false);
  const [burned, setBurned] = createSignal(false);
  const [loadBtnText, setLoadBtnText] = createSignal("View");
  const [loadBtnDisabled, setLoadBtnDisabled] = createSignal(false);

  const [contentType, setContentType] = createSignal<ContentType>("binary");
  const [textContent, setTextContent] = createSignal("");
  const [imageSrc, setImageSrc] = createSignal("");
  const [imageAlt, setImageAlt] = createSignal("");
  const [fileName, setFileName] = createSignal("");

  let decryptedBlob: Blob | null = null;
  let cryptoKey: CryptoKey;

  onMount(async () => {
    const id = params.id;
    const keyEncoded = window.location.hash.slice(1);

    if (!id || !keyEncoded) {
      setError("Invalid URL.");
      setStage("error");
      return;
    }

    try {
      cryptoKey = await importKey(keyEncoded);
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
    setStage("meta");
  });

  const handleView = async () => {
    setLoadBtnDisabled(true);
    setLoadBtnText("Decrypting\u2026");

    try {
      const res = await fetch(`/api/file/${params.id}`);
      if (!res.ok) {
        setError("File not found or expired.");
        setStage("error");
        return;
      }

      const buf = await res.arrayBuffer();
      const { fileName: name, fileData } = await decrypt(
        new Uint8Array(buf),
        cryptoKey,
      );
      const ext = getExt(name);
      setFileName(name);

      if (burnAfterRead()) setBurned(true);

      if (IMAGE_EXTS.has(ext)) {
        const mime = IMAGE_MIME[ext] || "image/png";
        const blob = new Blob([fileData], { type: mime });
        decryptedBlob = blob;
        setImageSrc(URL.createObjectURL(blob));
        setImageAlt(name);
        setContentType("image");
      } else if (TEXT_EXTS.has(ext)) {
        setTextContent(new TextDecoder().decode(fileData));
        setContentType("text");
      } else {
        decryptedBlob = new Blob([fileData]);
        setContentType("binary");
      }

      setStage("content");
    } catch {
      setError("Failed to decrypt. The key may be wrong.");
      setLoadBtnDisabled(false);
      setLoadBtnText("Retry");
    }
  };

  const copyText = () => {
    navigator.clipboard.writeText(textContent());
  };

  const viewRaw = () => {
    const w = window.open();
    if (w)
      w.document.write(`<pre>${textContent().replace(/</g, "&lt;")}</pre>`);
  };

  const saveFile = () => {
    if (decryptedBlob) triggerDownload(decryptedBlob, fileName());
  };

  return (
    <>
      <Show when={stage() === "meta"}>
        <div>
          <div class="mb-1 font-mono text-base">Encrypted file</div>
          <div class="text-muted mb-1 flex gap-3 text-xs">
            <span>{formatBytes(size())}</span>
            <span>{formatExpiry(expiresAt())}</span>
          </div>
          <Show when={burnAfterRead()}>
            <div class="mb-3">
              <span
                class="text-danger inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-danger) 10%, transparent)",
                }}
              >
                Burns after viewing
              </span>
            </div>
          </Show>
          <div class="mt-4">
            <button
              class="bg-accent hover:bg-accent-hover w-full cursor-pointer rounded-md border-none py-2.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              disabled={loadBtnDisabled()}
              onClick={handleView}
            >
              {loadBtnText()}
            </button>
          </div>
        </div>
      </Show>

      <Show when={stage() === "content"}>
        <Switch>
          <Match when={contentType() === "text"}>
            <div class="relative">
              <div class="absolute top-2 right-2 z-10 flex gap-1">
                <button
                  class="bg-surface text-muted hover:text-text border-border cursor-pointer rounded-md border p-1.5 transition-colors"
                  title="Copy"
                  onClick={copyText}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                </button>
                <button
                  class="bg-surface text-muted hover:text-text border-border cursor-pointer rounded-md border p-1.5 transition-colors"
                  title="Raw"
                  onClick={viewRaw}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="4 7 4 4 20 4 20 7" />
                    <line x1="9" x2="15" y1="20" y2="20" />
                    <line x1="12" x2="12" y1="4" y2="20" />
                  </svg>
                </button>
              </div>
              <div class="bg-surface border-border max-h-[60vh] w-full overflow-auto rounded-lg border p-4 pt-10 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                {textContent()}
              </div>
            </div>
          </Match>

          <Match when={contentType() === "image"}>
            <div class="w-full">
              <img
                src={imageSrc()}
                alt={imageAlt()}
                class="max-w-full rounded-lg shadow-sm"
              />
            </div>
            <div class="mt-3">
              <button
                class="bg-surface text-text border-border hover:bg-surface w-full cursor-pointer rounded-md border py-2 text-sm font-medium transition-colors"
                onClick={saveFile}
              >
                Save
              </button>
            </div>
          </Match>

          <Match when={contentType() === "binary"}>
            <div class="bg-surface border-border rounded-lg border p-4 text-center">
              <p class="mb-3 font-mono text-sm">{fileName()}</p>
              <button
                class="bg-accent hover:bg-accent-hover w-full cursor-pointer rounded-md border-none py-2.5 text-sm font-medium text-white transition-colors"
                onClick={saveFile}
              >
                Download
              </button>
            </div>
          </Match>
        </Switch>

        <Show when={burned()}>
          <div class="text-danger mt-3 text-xs">
            This file has been burned and can no longer be viewed.
          </div>
        </Show>
      </Show>

      <Show when={stage() === "error"}>
        <div class="text-danger mt-4 text-xs">{error()}</div>
      </Show>
    </>
  );
}
