import { config } from "./config.ts";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self'",
].join("; ");

const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export function applySecurityHeaders(headers = new Headers()): Headers {
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return headers;
}

export function apiHeaders(headers = new Headers()): Headers {
  applySecurityHeaders(headers);
  headers.set("Cache-Control", "no-store");
  return headers;
}

export function json(body: unknown, status = 200): Response {
  const headers = apiHeaders();
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

export function requireTrustedOrigin(
  request: Request,
  url = new URL(request.url),
): Response | undefined {
  if (!unsafeMethods.has(request.method.toUpperCase())) {
    return undefined;
  }

  if (!hasTrustedRequestOrigin(request, config.publicOrigin || url.origin)) {
    return json({ error: "Request origin is not allowed." }, 403);
  }

  return undefined;
}

function hasTrustedRequestOrigin(request: Request, applicationOrigin: string): boolean {
  const normalizedApplicationOrigin = normalizeOrigin(applicationOrigin);
  const origin = readHeaderOrigin(request, "Origin");
  if (origin) {
    return isTrustedOrigin(normalizedApplicationOrigin, origin);
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return false;
  }

  const referer = readHeaderOrigin(request, "Referer");
  if (referer) {
    return isTrustedOrigin(normalizedApplicationOrigin, referer);
  }

  return true;
}

function readHeaderOrigin(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value) {
    return "";
  }

  try {
    return normalizeOrigin(value);
  } catch {
    return "";
  }
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

function isTrustedOrigin(applicationOrigin: string, origin: string): boolean {
  if (origin === applicationOrigin) {
    return true;
  }

  return isLoopbackHttpOrigin(applicationOrigin) && isLoopbackHttpOrigin(origin);
}

function isLoopbackHttpOrigin(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    isIpv4LoopbackHostname(normalized)
  );
}

function isIpv4LoopbackHostname(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts[0] !== "127") {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}
