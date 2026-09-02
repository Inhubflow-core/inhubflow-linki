import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    try {
      const { agent, activeVersion } = ensureSdrAgent(db);

      let policy = { company_context: "", handoff_rules: "" };
      let config = { custom_instructions: "" };
      try {
        if (activeVersion?.policy_json) policy = JSON.parse(activeVersion.policy_json);
        if (activeVersion?.config_json) config = JSON.parse(activeVersion.config_json);
      } catch {}

      // Metrics / Stats
      const totalDecisions = (db.prepare("SELECT COUNT(*) as c FROM sdr_decisions").get() as any)?.c || 0;
      const totalHandoffs = (db.prepare("SELECT COUNT(*) as c FROM sdr_decisions WHERE requires_human = 1").get() as any)?.c || 0;
      const totalThreads = (db.prepare("SELECT COUNT(*) as c FROM sdr_threads").get() as any)?.c || 0;
      const activeThreads = (db.prepare("SELECT COUNT(*) as c FROM sdr_threads WHERE state = 'AI_ACTIVE'").get() as any)?.c || 0;

      const recentDecisions = db.prepare(`
        SELECT d.*, t.full_name as target_name, t.company as target_company
        FROM sdr_decisions d
        LEFT JOIN sdr_threads th ON d.thread_id = th.id
        LEFT JOIN targets t ON th.target_id = t.id
        ORDER BY d.created_at DESC
        LIMIT 10
      `).all();

      return res.status(200).json({
        agent,
        activeVersion: {
          ...activeVersion,
          policy,
          config,
        },
        stats: {
          totalDecisions,
          totalHandoffs,
          totalThreads,
          activeThreads,
        },
        recentDecisions,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Error al obtener configuración SDR" });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    try {
      const {
        name,
        mode,
        model,
        default_language,
        confidence_threshold,
        max_auto_turns,
        handoff_email,
        system_prompt,
        company_context,
        custom_instructions,
        handoff_rules,
      } = req.body;

      const { agent } = ensureSdrAgent(db);

      db.transaction(() => {
        // Update agent record
        db.prepare(`
          UPDATE sdr_agents
          SET
            name = COALESCE(?, name),
            mode = COALESCE(?, mode),
            model = COALESCE(?, model),
            default_language = COALESCE(?, default_language),
            confidence_threshold = COALESCE(?, confidence_threshold),
            max_auto_turns = COALESCE(?, max_auto_turns),
            handoff_email = COALESCE(?, handoff_email),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          name ?? null,
          mode ?? null,
          model ?? null,
          default_language ?? null,
          confidence_threshold ?? null,
          max_auto_turns ?? null,
          handoff_email ?? null,
          agent.id
        );

        // If prompt or policies changed, create new version or update current
        if (system_prompt !== undefined || company_context !== undefined || custom_instructions !== undefined || handoff_rules !== undefined) {
          const currentVersion = db.prepare("SELECT * FROM sdr_agent_versions WHERE id = ?").get(agent.active_version_id) as any;
          const currentPolicy = currentVersion?.policy_json ? JSON.parse(currentVersion.policy_json) : {};
          const currentConfig = currentVersion?.config_json ? JSON.parse(currentVersion.config_json) : {};

          const nextPolicy = {
            ...currentPolicy,
            company_context: company_context !== undefined ? company_context : currentPolicy.company_context,
            handoff_rules: handoff_rules !== undefined ? handoff_rules : currentPolicy.handoff_rules,
          };

          const nextConfig = {
            ...currentConfig,
            custom_instructions: custom_instructions !== undefined ? custom_instructions : currentConfig.custom_instructions,
          };

          const newVersionId = randomUUID();
          const nextVersionNum = ((db.prepare("SELECT MAX(version_number) as m FROM sdr_agent_versions WHERE agent_id = ?").get(agent.id) as any)?.m || 0) + 1;

          db.prepare(`
            INSERT INTO sdr_agent_versions (
              id, agent_id, version_number, model, system_prompt, policy_json, config_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            newVersionId,
            agent.id,
            nextVersionNum,
            model || agent.model || "gemini-3.6-flash",
            system_prompt || currentVersion?.system_prompt || "",
            JSON.stringify(nextPolicy),
            JSON.stringify(nextConfig)
          );

          db.prepare(`
            UPDATE sdr_agents
            SET active_version_id = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(newVersionId, agent.id);
        }
      })();

      return res.status(200).json({ ok: true, message: "Configuración guardada exitosamente" });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Error al actualizar configuración SDR" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PUT"]);
  return res.status(405).json({ error: "Method not allowed" });
}
