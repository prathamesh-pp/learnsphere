import type { NextFunction, Request, Response } from "express";

type Entry = { count: number; resetAt: number };
export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> | { allowed: boolean; retryAfterSeconds: number };
}

export class ProcessLocalRateLimitStore implements RateLimitStore {
  readonly entries = new Map<string, Entry>();
  consume(key: string, limit: number, windowMs: number, now: number) {
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + windowMs }; this.entries.set(key, entry); }
    if (entry.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    entry.count += 1;
    if (this.entries.size > 10_000) for (const [entryKey, value] of this.entries) if (value.resetAt <= now) this.entries.delete(entryKey);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Process-local limiter. Replace with a shared atomic store before multi-instance production deployment. */
export function createAuthRateLimiter(limit: number, windowMs: number, store: RateLimitStore = new ProcessLocalRateLimitStore()) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const now = Date.now();
    const key = `${request.path}:${request.ip ?? "unknown"}`;
    try {
      const result = await store.consume(key, limit, windowMs, now);
      if (!result.allowed) {
        response.setHeader("Retry-After", result.retryAfterSeconds);
        response.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } });
        return;
      }
    } catch {
      response.status(503).json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Authentication is temporarily unavailable." } });
      return;
    }
    next();
  };
}
