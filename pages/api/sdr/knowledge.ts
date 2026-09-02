import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { applySdrSchema } from "@/lib/sdr-agent/schema";

function getOrCreateAgentId(db: any): string {
  try {
    applySdrSchema(db);
  } catch {}

  let agent = db.prepare("SELECT id FROM sdr_agents ORDER BY created_at ASC LIMIT 1").get() as any;
  if (!agent) {
    const agentId = randomUUID();
    const versionId = randomUUID();
    const defaultPrompt = `Eres un Agente SDR de Inteligencia Artificial para InHubFlow, experto en prospección y ventas B2B en LinkedIn y Cold Email.`;
    const defaultCompanyContext = `InHubFlow es una suite empresarial de prospección comercial omnicanal B2B.`;

    db.prepare(`
      INSERT INTO sdr_agents (
        id, name, status, mode, default_language, model, active_version_id, confidence_threshold, max_auto_turns
      ) VALUES (?, ?, 'active', 'approval', 'es', 'gemini-3.6-flash', ?, 0.85, 3)
    `).run(agentId, "Agente SDR InHubFlow", versionId);

    db.prepare(`
      INSERT INTO sdr_agent_versions (
        id, agent_id, version_number, model, system_prompt, policy_json, config_json
      ) VALUES (?, ?, 1, 'gemini-3.6-flash', ?, ?, ?)
    `).run(
      versionId,
      agentId,
      defaultPrompt,
      JSON.stringify({ company_context: defaultCompanyContext, handoff_rules: "" }),
      JSON.stringify({ custom_instructions: "" })
    );

    return agentId;
  }
  return agent.id;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    try {
      const agentId = getOrCreateAgentId(db);
      const sources = db.prepare("SELECT * FROM sdr_knowledge_sources WHERE agent_id = ? ORDER BY created_at DESC").all(agentId) as any[];

      const parsedSources = sources.map((s) => {
        let meta = { content: "" };
        try {
          meta = JSON.parse(s.metadata_json);
        } catch {}
        return {
          ...s,
          content: meta.content || "",
        };
      });

      return res.status(200).json({ sources: parsedSources });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Error al obtener fuentes de conocimiento" });
    }
  }

  if (req.method === "POST") {
    try {
      const { title, source_type, content, status } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "Título y contenido son obligatorios" });
      }

      const agentId = getOrCreateAgentId(db);
      const id = randomUUID();
      const metadata = JSON.stringify({ content: String(content) });

      const allowedTypes = ["text", "file", "url", "catalog", "policy"];
      const resolvedType = allowedTypes.includes(String(source_type).toLowerCase())
        ? String(source_type).toLowerCase()
        : "catalog";

      const allowedStatuses = ["draft", "approved", "retired"];
      const resolvedStatus = allowedStatuses.includes(String(status).toLowerCase())
        ? String(status).toLowerCase()
        : "approved";

      db.prepare(`
        INSERT INTO sdr_knowledge_sources (
          id, agent_id, status, title, source_type, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        agentId,
        resolvedStatus,
        title.trim(),
        resolvedType,
        metadata
      );

      return res.status(201).json({ id, ok: true });
    } catch (error: any) {
      console.error("[SDR Knowledge POST Error]:", error);
      return res.status(500).json({ error: error.message || "Error al crear fuente de conocimiento" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { id } = req.query;
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "ID inválido" });
      }

      db.prepare("DELETE FROM sdr_knowledge_sources WHERE id = ?").run(id);
      return res.status(200).json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Error al eliminar fuente" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).json({ error: "Method not allowed" });
}
