import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessSdrThread, requireApiActor } from "@/lib/authz";
import { takeHumanControl } from "@/lib/sdr-agent/handoff";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const threadId = Array.isArray(req.query.threadId) ? req.query.threadId[0] : req.query.threadId;
  if (!threadId) return res.status(400).json({ error: "Thread id is required" });
  const db = getDb();
  if (!canAccessSdrThread(db, actor, threadId)) return res.status(404).json({ error: "Thread not found" });
  try {
    const result = takeHumanControl(db, {
      threadId,
      actorUserId: actor.id,
      workspaceOwnerId: actor.workspaceOwnerId,
      allowAdministrativeOverride: actor.isWorkspaceAdmin,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Unable to take control" });
  }
}
