import { createMiddleware } from "hono/factory";
import { config } from "../config.ts";

const WINDOW_MS = config.rateLimitWindowS * 1000;
const MAX_REQUESTS = config.rateLimitMax;

const requests = new Map<string, number[]>();

// Clean up stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requests) {
    if (timestamps.every((t) => now - t > WINDOW_MS)) {
      requests.delete(ip);
    }
  }
}, WINDOW_MS);

export const rateLimit = createMiddleware(async (c, next) => {
  const ip =
    c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  const now = Date.now();
  const timestamps = (requests.get(ip) ?? []).filter(
    (t) => now - t < WINDOW_MS,
  );

  if (timestamps.length >= MAX_REQUESTS) {
    return c.json({ error: "Too many requests" }, 429);
  }

  timestamps.push(now);
  requests.set(ip, timestamps);
  await next();
});
