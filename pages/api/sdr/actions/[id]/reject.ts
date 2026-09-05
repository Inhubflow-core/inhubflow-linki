import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessSdrThread, requireApiActor } from "@/lib/authz";
import { recordSdrAuditEvent } from "@/lib/audit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const actionId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!actionId) return res.status(400).json({ error: "Action id is required" });

  const db = getDb();
  const action = db.prepare(`
    SELECT id, thread_id, workspace_owner_id, state FROM sdr_actions WHERE id = ?
  `).get(actionId) as { id: string; thread_id: string; workspace_owner_id: string | null; state: string } | undefined;

  if (!action) {
    return res.status(404).json({ error: "Acción SDR no encontrada" });
  }

  if (!canAccessSdrThread(db, actor, action.thread_id)) {
    return res.status(404).json({ error: "Conversación no encontrada o no autorizada" });
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "descartado_por_usuario";

  db.prepare(`
    UPDATE sdr_actions
    SET state = 'rejected',
        rejected_by_user_id = ?,
        rejected_at = datetime('now'),
        rejection_reason = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(actor.id, reason, action.id);

  recordSdrAuditEvent(db, {
    workspaceOwnerId: actor.workspaceOwnerId,
    actorType: "user",
    actorUserId: actor.id,
    entityType: "action",
    entityId: action.id,
    eventType: "sdr_action_rejected",
    threadId: action.thread_id,
    actionId: action.id,
    idempotencyKey: `audit:reject:${action.id}`,
    payload: { reason },
  });

  return res.status(200).json({ ok: true, actionId: action.id, state: "rejected" });
}
