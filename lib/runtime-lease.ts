import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export function tryAcquireRuntimeLease(
  db: Database.Database,
  leaseKey: string,
  ttlMs: number,
  nowMs = Date.now()
): string | null {
  const ownerId = randomUUID();
  const expiresAtMs = nowMs + ttlMs;
  const result = db.prepare(`
    INSERT INTO runtime_leases (lease_key, owner_id, expires_at_ms, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(lease_key) DO UPDATE SET
      owner_id = excluded.owner_id,
      expires_at_ms = excluded.expires_at_ms,
      updated_at = excluded.updated_at
    WHERE runtime_leases.expires_at_ms <= ?
  `).run(leaseKey, ownerId, expiresAtMs, nowMs);
  return result.changes === 1 ? ownerId : null;
}

export function renewRuntimeLease(
  db: Database.Database,
  leaseKey: string,
  ownerId: string,
  ttlMs: number,
  nowMs = Date.now()
): boolean {
  const result = db.prepare(`
    UPDATE runtime_leases
    SET expires_at_ms = ?, updated_at = datetime('now')
    WHERE lease_key = ? AND owner_id = ? AND expires_at_ms > ?
  `).run(nowMs + ttlMs, leaseKey, ownerId, nowMs);
  return result.changes === 1;
}

export function releaseRuntimeLease(
  db: Database.Database,
  leaseKey: string,
  ownerId: string
): void {
  db.prepare("DELETE FROM runtime_leases WHERE lease_key = ? AND owner_id = ?")
    .run(leaseKey, ownerId);
}
