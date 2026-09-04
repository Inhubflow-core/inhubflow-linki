import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { cancelSdrJob, failSdrJob, leaseNextSdrJob } from "./jobs";
import { processLeasedClassificationJob } from "./orchestrator";
import { deliverQueuedWebPush } from "@/lib/notifications/push";

export interface SdrWorkerTickResult {
  processed: number;
  failed: number;
  cancelled: number;
  skipped: boolean;
  reason?: string;
}

function runtimeEnabled(): boolean {
  return process.env.SDR_RUNTIME_ENABLED?.trim().toLowerCase() === "true";
}

function updateHeartbeat(
  db: Database.Database,
  workerId: string,
  data: { error?: string | null; success?: boolean; startedAt?: string },
): void {
  const queue = db.prepare(`
    SELECT COUNT(*) AS depth, MIN(created_at) AS oldest
    FROM sdr_jobs WHERE state IN ('queued', 'leased', 'waiting')
  `).get() as { depth: number; oldest: string | null };
  db.prepare(`
    INSERT INTO sdr_runtime_state (
      scope_key, worker_id, worker_started_at, last_heartbeat_at,
      last_tick_at, last_success_at, last_error, queue_depth, oldest_job_at
    ) VALUES ('global', ?, ?, datetime('now'), datetime('now'),
      CASE WHEN ? THEN datetime('now') ELSE NULL END, ?, ?, ?)
    ON CONFLICT(scope_key) DO UPDATE SET
      worker_id = excluded.worker_id,
      worker_started_at = COALESCE(sdr_runtime_state.worker_started_at, excluded.worker_started_at),
      last_heartbeat_at = datetime('now'),
      last_tick_at = datetime('now'),
      last_success_at = CASE WHEN ? THEN datetime('now') ELSE sdr_runtime_state.last_success_at END,
      last_error = excluded.last_error,
      queue_depth = excluded.queue_depth,
      oldest_job_at = excluded.oldest_job_at,
      updated_at = datetime('now')
  `).run(
    workerId,
    data.startedAt ?? null,
    data.success ? 1 : 0,
    data.error?.slice(0, 2_000) ?? null,
    queue.depth,
    queue.oldest,
    data.success ? 1 : 0,
  );
}

export async function runSdrWorkerTick(
  db: Database.Database,
  options: { workerId?: string; maxJobs?: number } = {},
): Promise<SdrWorkerTickResult> {
  if (!runtimeEnabled()) {
    return { processed: 0, failed: 0, cancelled: 0, skipped: true, reason: "runtime_disabled" };
  }
  const workerId = options.workerId ?? `sdr-worker-${process.pid}`;
  const maxJobs = Math.max(1, Math.min(options.maxJobs ?? 5, 25));
  const result: SdrWorkerTickResult = {
    processed: 0,
    failed: 0,
    cancelled: 0,
    skipped: false,
  };

  for (let index = 0; index < maxJobs; index++) {
    const job = leaseNextSdrJob(db, { workerId, leaseMs: 300_000 });
    if (!job) break;
    if (job.job_type !== "classify") {
      cancelSdrJob(db, job.id, job.lease_token);
      result.cancelled++;
      continue;
    }
    try {
      const processed = await processLeasedClassificationJob(db, job, { workerId });
      if (processed.status === "completed") result.processed++;
      else if (processed.status === "cancelled") result.cancelled++;
    } catch (error) {
      result.failed++;
      failSdrJob(db, job.id, {
        leaseToken: job.lease_token,
        error: error instanceof Error ? error.message : String(error),
        retryDelayMs: Math.min(60_000, 2_000 * 2 ** Math.max(0, job.attempts - 1)),
      });
    }
  }

  try {
    const push = await deliverQueuedWebPush(db);
    result.processed += push.sent;
    result.failed += push.failed;
  } catch {
    result.failed++;
  }
  updateHeartbeat(db, workerId, { success: result.failed === 0 });
  return result;
}

const globalWorker = globalThis as typeof globalThis & {
  __inhubflowSdrWorkerStarted?: boolean;
};

export function ensureSdrWorkerStarted(): void {
  if (globalWorker.__inhubflowSdrWorkerStarted || !runtimeEnabled()) return;
  globalWorker.__inhubflowSdrWorkerStarted = true;
  const workerId = `sdr-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const pollMs = Math.max(1_000, Math.min(Number(process.env.SDR_WORKER_POLL_MS) || 5_000, 60_000));
  const db = getDb();
  updateHeartbeat(db, workerId, { startedAt, success: true });

  const loop = async () => {
    try {
      await runSdrWorkerTick(db, { workerId });
    } catch (error) {
      updateHeartbeat(db, workerId, {
        error: error instanceof Error ? error.message : String(error),
        success: false,
      });
    } finally {
      const timer = setTimeout(loop, pollMs);
      timer.unref?.();
    }
  };
  void loop();
}
