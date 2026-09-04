import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canManageSdrAgent, requireApiActor } from "@/lib/authz";
import { recordSdrAuditEvent } from "@/lib/audit";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();
  const { agent, activeVersion } = ensureSdrAgent(db, actor.workspaceOwnerId);
  if (!canManageSdrAgent(db, actor, agent.id)) return res.status(403).json({ error: "No autorizado" });
  if (!activeVersion) return res.status(409).json({ error: "No existe una versión activa" });
  if (!activeVersion.system_prompt.trim()) return res.status(409).json({ error: "El prompt del sistema está vacío" });
  const approvedKnowledge = (db.prepare(`
    SELECT COUNT(*) AS count FROM sdr_knowledge_sources
    WHERE agent_id = ? AND workspace_owner_id = ? AND status = 'approved'
      AND content IS NOT NULL AND length(trim(content)) > 0
  `).get(agent.id, actor.workspaceOwnerId) as { count: number }).count;
  if (approvedKnowledge === 0) {
    return res.status(409).json({ error: "Aprueba al menos una fuente de conocimiento antes de publicar" });
  }

  const revisionHash = createHash("sha256")
    .update(JSON.stringify({
      model: activeVersion.model,
      systemPrompt: activeVersion.system_prompt,
      policy: activeVersion.policy_json,
      config: activeVersion.config_json,
      knowledgeRevision: approvedKnowledge,
    }), "utf8")
    .digest("hex");
  db.transaction(() => {
    db.prepare(`
      UPDATE sdr_agent_versions
      SET publication_state = 'published', revision_hash = ?,
        published_by_user_id = ?, published_at = datetime('now')
      WHERE id = ? AND agent_id = ?
    `).run(revisionHash, actor.id, activeVersion.id, agent.id);
    db.prepare(`
      UPDATE sdr_agents
      SET status = 'active', runtime_enabled = 1, provider_enabled = 1,
        updated_at = datetime('now')
      WHERE id = ? AND workspace_owner_id = ?
    `).run(agent.id, actor.workspaceOwnerId);
    recordSdrAuditEvent(db, {
      workspaceOwnerId: actor.workspaceOwnerId,
      actorType: "user",
      actorUserId: actor.id,
      entityType: "agent_version",
      entityId: activeVersion.id,
      eventType: "version_published",
      idempotencyKey: `publish:${activeVersion.id}:${revisionHash}`,
      payload: { revisionHash, approvedKnowledge },
    });
  })();
  return res.status(200).json({ ok: true, versionId: activeVersion.id, revisionHash });
}
