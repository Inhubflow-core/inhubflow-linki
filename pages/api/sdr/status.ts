import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { sdrAgentBridge } from "@/lib/sdr-agent";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();
  const status = sdrAgentBridge.getStatus(actor.workspaceOwnerId);
  const runtime = db.prepare(
    "SELECT worker_id, last_heartbeat_at, last_tick_at, last_success_at, last_error, queue_depth, oldest_job_at FROM sdr_runtime_state WHERE scope_key = 'global'",
  ).get() as Record<string, unknown> | undefined;
  const queue = db.prepare(`
    SELECT state, COUNT(*) AS count FROM sdr_jobs
    WHERE workspace_owner_id IS ? GROUP BY state
  `).all(actor.workspaceOwnerId) as Array<{ state: string; count: number }>;
  return res.status(200).json({
    ...status,
    worker: runtime ?? null,
    queue: Object.fromEntries(queue.map((item) => [item.state, item.count])),
  });
}
