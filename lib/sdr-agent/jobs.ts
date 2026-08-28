import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type SdrJobType =
  | "classify"
  | "decide"
  | "execute_tool"
  | "send_reply"
  | "handoff"
  | "calendar";

export type SdrJobState = "queued" | "leased" | "waiting" | "completed" | "failed" | "cancelled";

export interface EnqueueSdrJobInput {
  threadId?: string | null;
  messageId?: string | null;
  jobType: SdrJobType;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
}

export interface SdrJob {
  id: string;
  thread_id: string | null;
  message_id: string | null;
  job_type: SdrJobType;
  state: SdrJobState;
  idempotency_key: string;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface LeasedSdrJob extends SdrJob {
  state: "leased";
  lease_token: string;
  lease_expires_at: string;
}

export interface LeaseOptions {
  workerId: string;
  leaseMs?: number;
  now?: Date;
}

export interface FailJobOptions {
  leaseToken: string;
  error: string;
  retryDelayMs?: number;
  now?: Date;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 60_000;
const MAX_ERROR_LENGTH = 10_000;

function toSqliteDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function clampAttempts(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("SDR job maxAttempts must be an integer between 1 and 100");
  }
  return value;
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`SDR job ${field} cannot be empty`);
}

function readJob(db: Database.Database, id: string): SdrJob | null {
  return (db.prepare("SELECT * FROM sdr_jobs WHERE id = ?").get(id) as SdrJob | undefined) ?? null;
}

/**
 * Enqueues an SDR job exactly once. Reusing an idempotency key returns the
 * original job and never overwrites its payload or retry state.
 */
export function enqueueSdrJob(db: Database.Database, input: EnqueueSdrJobInput): SdrJob {
  assertNonEmpty(input.idempotencyKey, "idempotencyKey");
  if (input.payload !== undefined && (input.payload === null || typeof input.payload !== "object" || Array.isArray(input.payload))) {
    throw new Error("SDR job payload must be a JSON object");
  }
  const maxAttempts = clampAttempts(input.maxAttempts);
  const payloadJson = JSON.stringify(input.payload ?? {});
  const id = randomUUID();

  db.prepare(`
    INSERT INTO sdr_jobs (
      id, thread_id, message_id, job_type, state, idempotency_key,
      payload_json, max_attempts, next_attempt_at
    ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(
    id,
    input.threadId ?? null,
    input.messageId ?? null,
    input.jobType,
    input.idempotencyKey,
    payloadJson,
    maxAttempts,
    input.nextAttemptAt ?? null,
  );

  const job = readJob(db, id) ?? db.prepare(
    "SELECT * FROM sdr_jobs WHERE idempotency_key = ?"
  ).get(input.idempotencyKey) as SdrJob | undefined;
  if (!job) throw new Error("SDR job could not be loaded after enqueue");
  return job;
}

/** Returns a job by its idempotency key without modifying it. */
export function getSdrJobByIdempotencyKey(db: Database.Database, idempotencyKey: string): SdrJob | null {
  assertNonEmpty(idempotencyKey, "idempotencyKey");
  return (db.prepare("SELECT * FROM sdr_jobs WHERE idempotency_key = ?").get(idempotencyKey) as SdrJob | undefined) ?? null;
}

/**
 * Requeues expired leases. A job that exhausted its attempts is permanently
 * failed; unfinished jobs remain queued for another worker.
 */
export function recoverExpiredSdrLeases(db: Database.Database, now = new Date()): number {
  const timestamp = toSqliteDate(now);
  const result = db.prepare(`
    UPDATE sdr_jobs
    SET
      state = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = CASE
        WHEN attempts >= max_attempts THEN COALESCE(last_error, 'Lease expired after maximum attempts')
        ELSE last_error
      END,
      updated_at = ?
    WHERE state = 'leased'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= ?
  `).run(timestamp, timestamp);
  return result.changes;
}

/**
 * Leases one due queued job. The conditional UPDATE makes the claim safe when
 * multiple workers race for the same row, while the transaction keeps recovery
 * and claiming atomic for this SQLite connection.
 */
export function leaseNextSdrJob(db: Database.Database, options: LeaseOptions): LeasedSdrJob | null {
  assertNonEmpty(options.workerId, "workerId");
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 86_400_000) {
    throw new Error("SDR job leaseMs must be an integer between 1000 and 86400000");
  }

  const now = options.now ?? new Date();
  const nowSql = toSqliteDate(now);
  const expiresAt = new Date(now.getTime() + leaseMs);
  const expiresSql = toSqliteDate(expiresAt);
  const leaseToken = `${options.workerId}:${randomUUID()}`;

  return db.transaction(() => {
    recoverExpiredSdrLeases(db, now);
    const candidates = db.prepare(`
      SELECT id
      FROM sdr_jobs
      WHERE state = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC, id ASC
      LIMIT 10
    `).all(nowSql) as Array<{ id: string }>;

    for (const candidate of candidates) {
      const claimed = db.prepare(`
        UPDATE sdr_jobs
        SET
          state = 'leased',
          attempts = attempts + 1,
          lease_token = ?,
          lease_expires_at = ?,
          updated_at = ?
        WHERE id = ? AND state = 'queued'
      `).run(leaseToken, expiresSql, nowSql, candidate.id);
      if (claimed.changes !== 1) continue;
      const job = readJob(db, candidate.id);
      if (job?.state === "leased" && job.lease_token === leaseToken && job.lease_expires_at) {
        return job as LeasedSdrJob;
      }
    }
    return null;
  })();
}

/**
 * Leases a specific job by id if it is in queued state.
 */
export function leaseSdrJob(db: Database.Database, jobId: string, options: LeaseOptions): LeasedSdrJob | null {
  assertNonEmpty(jobId, "id");
  assertNonEmpty(options.workerId, "workerId");
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const now = options.now ?? new Date();
  const nowSql = toSqliteDate(now);
  const expiresAt = new Date(now.getTime() + leaseMs);
  const expiresSql = toSqliteDate(expiresAt);
  const leaseToken = `${options.workerId}:${randomUUID()}`;

  const claimed = db.prepare(`
    UPDATE sdr_jobs
    SET
      state = 'leased',
      attempts = attempts + 1,
      lease_token = ?,
      lease_expires_at = ?,
      updated_at = ?
    WHERE id = ? AND state = 'queued'
  `).run(leaseToken, expiresSql, nowSql, jobId);

  if (claimed.changes !== 1) return null;
  const job = readJob(db, jobId);
  if (job?.state === "leased" && job.lease_token === leaseToken && job.lease_expires_at) {
    return job as LeasedSdrJob;
  }
  return null;
}

/** Extends a lease only when the caller still owns it. */
export function renewSdrJobLease(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  leaseMs = DEFAULT_LEASE_MS,
  now = new Date(),
): boolean {
  assertNonEmpty(jobId, "id");
  assertNonEmpty(leaseToken, "leaseToken");
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 86_400_000) {
    throw new Error("SDR job leaseMs must be an integer between 1000 and 86400000");
  }
  const result = db.prepare(`
    UPDATE sdr_jobs
    SET lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND state = 'leased' AND lease_token = ? AND lease_expires_at > ?
  `).run(
    toSqliteDate(new Date(now.getTime() + leaseMs)),
    toSqliteDate(now),
    jobId,
    leaseToken,
    toSqliteDate(now),
  );
  return result.changes === 1;
}

/** Completes a leased job and clears its lease token. */
export function completeSdrJob(
  db: Database.Database,
  jobId: string,
  leaseToken: string,
  now = new Date(),
): boolean {
  assertNonEmpty(jobId, "id");
  assertNonEmpty(leaseToken, "leaseToken");
  const timestamp = toSqliteDate(now);
  const result = db.prepare(`
    UPDATE sdr_jobs
    SET
      state = 'completed',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = NULL,
      completed_at = ?,
      updated_at = ?
    WHERE id = ? AND state = 'leased' AND lease_token = ? AND lease_expires_at > ?
  `).run(timestamp, timestamp, jobId, leaseToken, timestamp);
  return result.changes === 1;
}

/**
 * Fails a leased job. It is requeued with a bounded delay until maxAttempts is
 * reached, then becomes terminally failed. Ownership is checked by token.
 */
export function failSdrJob(
  db: Database.Database,
  jobId: string,
  options: FailJobOptions,
): SdrJob | null {
  assertNonEmpty(jobId, "id");
  assertNonEmpty(options.leaseToken, "leaseToken");
  assertNonEmpty(options.error, "error");
  const now = options.now ?? new Date();
  const timestamp = toSqliteDate(now);
  const delayMs = options.retryDelayMs ?? 1_000;
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 86_400_000) {
    throw new Error("SDR job retryDelayMs must be an integer between 0 and 86400000");
  }
  const error = options.error.slice(0, MAX_ERROR_LENGTH);
  const job = readJob(db, jobId);
  if (!job || job.state !== "leased" || job.lease_token !== options.leaseToken || !job.lease_expires_at || job.lease_expires_at <= timestamp) {
    return null;
  }

  const nextAttemptAt = toSqliteDate(new Date(now.getTime() + delayMs));
  db.prepare(`
    UPDATE sdr_jobs
    SET
      state = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = CASE WHEN attempts >= max_attempts THEN NULL ELSE ? END,
      last_error = ?,
      updated_at = ?,
      completed_at = CASE WHEN attempts >= max_attempts THEN ? ELSE NULL END
    WHERE id = ? AND state = 'leased' AND lease_token = ? AND lease_expires_at > ?
  `).run(nextAttemptAt, error, timestamp, timestamp, jobId, options.leaseToken, timestamp);

  return readJob(db, jobId);
}

/** Cancels a queued, waiting, or owned leased job. */
export function cancelSdrJob(
  db: Database.Database,
  jobId: string,
  leaseToken?: string,
  now = new Date(),
): boolean {
  assertNonEmpty(jobId, "id");
  const timestamp = toSqliteDate(now);
  const result = db.prepare(`
    UPDATE sdr_jobs
    SET state = 'cancelled', lease_token = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE (
      id = ? AND state IN ('queued', 'waiting')
    ) OR (
      id = ? AND state = 'leased' AND lease_token = ?
    )
  `).run(timestamp, jobId, jobId, leaseToken ?? "");
  return result.changes === 1;
}

/** Parses a job payload while rejecting malformed persisted data. */
export function parseSdrJobPayload(job: SdrJob): Record<string, unknown> {
  try {
    const payload = JSON.parse(job.payload_json) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("not an object");
    return payload as Record<string, unknown>;
  } catch {
    throw new Error(`SDR job ${job.id} contains invalid payload JSON`);
  }
}

export { DEFAULT_MAX_ATTEMPTS, DEFAULT_LEASE_MS };
export { toSqliteDate as formatSdrSqliteDate };
