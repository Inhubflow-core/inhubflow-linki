import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export interface DurableRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function hashRateLimitIdentity(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function consumeDurableRateLimit(
  db: Database.Database,
  bucketKey: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): DurableRateLimitResult {
  if (!bucketKey.trim()) throw new Error("Rate-limit bucket key cannot be empty");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate-limit limit must be positive");
  if (!Number.isInteger(windowMs) || windowMs < 1_000) throw new Error("Rate-limit window must be at least one second");

  return db.transaction(() => {
    db.prepare("DELETE FROM durable_rate_limits WHERE expires_at <= ?").run(now);
    const row = db.prepare(
      "SELECT window_started_at, hit_count, expires_at FROM durable_rate_limits WHERE bucket_key = ?",
    ).get(bucketKey) as
      | { window_started_at: number; hit_count: number; expires_at: number }
      | undefined;

    if (!row || row.expires_at <= now) {
      db.prepare(`
        INSERT INTO durable_rate_limits (bucket_key, window_started_at, hit_count, expires_at, updated_at)
        VALUES (?, ?, 1, ?, datetime('now'))
        ON CONFLICT(bucket_key) DO UPDATE SET
          window_started_at = excluded.window_started_at,
          hit_count = 1,
          expires_at = excluded.expires_at,
          updated_at = datetime('now')
      `).run(bucketKey, now, now + windowMs);
      return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
    }

    if (row.hit_count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, row.expires_at - now),
      };
    }

    const nextCount = row.hit_count + 1;
    db.prepare(
      "UPDATE durable_rate_limits SET hit_count = ?, updated_at = datetime('now') WHERE bucket_key = ?",
    ).run(nextCount, bucketKey);
    return { allowed: true, remaining: Math.max(0, limit - nextCount), retryAfterMs: 0 };
  })();
}
