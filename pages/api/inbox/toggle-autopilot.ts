import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import {
  canAccessEmailAccount,
  canAccessLinkedInAccount,
  canAccessSdrThread,
  requireApiActor,
  sdrThreadMatchesTarget,
  targetBelongsToEmailAccount,
  targetBelongsToLinkedInAccount,
} from "@/lib/authz";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const targetId = typeof req.body?.targetId === "string" ? req.body.targetId : "";
  const accountId = typeof req.body?.accountId === "string" ? req.body.accountId : null;
  const emailAccountId = typeof req.body?.emailAccountId === "string" ? req.body.emailAccountId : null;
  const threadId = typeof req.body?.threadId === "string" ? req.body.threadId : null;
  if (!targetId) return res.status(400).json({ error: "Missing targetId" });

  const db = getDb();
  if (!accountId && !emailAccountId && !threadId) {
    return res.status(400).json({ error: "Conversation or account context is required" });
  }
  if (accountId && (
    !canAccessLinkedInAccount(db, actor, accountId)
    || !targetBelongsToLinkedInAccount(db, targetId, accountId)
  )) return res.status(404).json({ error: "Account target not found" });
  if (emailAccountId && (
    !canAccessEmailAccount(db, actor, emailAccountId)
    || !targetBelongsToEmailAccount(db, targetId, emailAccountId)
  )) return res.status(404).json({ error: "Email account target not found" });
  if (threadId && (
    !canAccessSdrThread(db, actor, threadId)
    || !sdrThreadMatchesTarget(db, threadId, targetId)
  )) return res.status(404).json({ error: "Conversation not found" });

  const current = db.prepare("SELECT id, sdr_autopilot, full_name FROM targets WHERE id = ?").get(targetId) as
    | { id: string; sdr_autopilot: number; full_name: string | null }
    | undefined;
  if (!current) return res.status(404).json({ error: "Target not found" });
  const nextVal = typeof req.body?.enabled === "boolean"
    ? (req.body.enabled ? 1 : 0)
    : (current.sdr_autopilot === 1 ? 0 : 1);
  const { agent } = ensureSdrAgent(db, actor.workspaceOwnerId);

  db.transaction(() => {
    db.prepare("UPDATE targets SET sdr_autopilot = ? WHERE id = ?").run(nextVal, targetId);
    if (accountId && nextVal === 1) {
      db.prepare("UPDATE accounts SET sdr_enabled = 1 WHERE id = ?").run(accountId);
      db.prepare(`
        INSERT INTO sdr_agent_accounts(agent_id, account_id, enabled, inbound_enabled, outbound_enabled)
        VALUES (?, ?, 1, 1, 0)
        ON CONFLICT(agent_id, account_id) DO UPDATE SET
          enabled = 1, inbound_enabled = 1
      `).run(agent.id, accountId);
    }
    if (emailAccountId && nextVal === 1) {
      db.prepare("UPDATE email_accounts SET sdr_enabled = 1 WHERE id = ?").run(emailAccountId);
    }
    if (threadId) {
      db.prepare(`
        UPDATE sdr_threads
        SET automation_enabled = ?, agent_id = COALESCE(agent_id, ?),
          agent_version_id = COALESCE(agent_version_id, ?), updated_at = datetime('now')
        WHERE id = ? AND target_id = ?
      `).run(nextVal, agent.id, agent.active_version_id, threadId, targetId);
    }
  })();

  return res.status(200).json({
    ok: true,
    targetId,
    sdr_autopilot: nextVal,
    message: nextVal === 1
      ? `Asistente SDR habilitado para ${current.full_name || "el lead"}. El modo efectivo y los gates siguen aplicándose.`
      : `Asistente SDR deshabilitado para ${current.full_name || "el lead"}.`,
  });
}
