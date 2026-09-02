import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { applySdrSchema } from "./schema";

export interface SdrAgentWithVersion {
  agent: any;
  activeVersion: any;
}

export function ensureSdrAgent(db: Database.Database): SdrAgentWithVersion {
  try {
    applySdrSchema(db);
  } catch (err) {
    console.error("[SDR Schema Error]:", err);
  }

  let agent = db.prepare("SELECT * FROM sdr_agents ORDER BY created_at ASC LIMIT 1").get() as any;

  if (!agent) {
    const agentId = randomUUID();
    const versionId = randomUUID();

    const defaultPrompt = `Eres un Agente SDR de Inteligencia Artificial para InHubFlow, experto en prospección y ventas B2B en LinkedIn y Cold Email.
Tu objetivo es analizar el mensaje entrante del prospecto, clasificar su intención, responder con empatía y valor, y proponer una breve llamada de 15 minutos para una demo.

Tono y Estilo:
- Profesional, cercano, empático y orientado a la acción.
- Respuestas breves y al grano (máximo 2 a 3 párrafos cortos).
- Si el prospecto tiene dudas o objeciones, valida su perspectiva y explica cómo InHubFlow le ahorra tiempo y multiplica sus oportunidades comerciales.`;

    const defaultCompanyContext = `InHubFlow es una suite empresarial de prospección comercial omnicanal B2B:
- Automatización inteligente de LinkedIn (visitas, solicitudes de conexión personalizadas, secuencias inteligentes).
- Cold Email secuenciado de alta entregabilidad con rotación multicuenta.
- Enriquecimiento de leads con Apollo.io y LinkedIn Sales Navigator.
- Agente SDR con Inteligencia Artificial que califica prospectos, responde dudas y agenda reuniones comerciales.`;

    // 1. Insert sdr_agents with active_version_id = NULL first to satisfy foreign keys
    db.prepare(`
      INSERT INTO sdr_agents (
        id, name, status, mode, default_language, model, active_version_id, confidence_threshold, max_auto_turns
      ) VALUES (?, ?, 'active', 'approval', 'es', 'gemini-3.6-flash', NULL, 0.85, 3)
    `).run(agentId, "Agente SDR InHubFlow");

    // 2. Next insert version referencing agentId
    db.prepare(`
      INSERT INTO sdr_agent_versions (
        id, agent_id, version_number, model, system_prompt, policy_json, config_json
      ) VALUES (?, ?, 1, 'gemini-3.6-flash', ?, ?, ?)
    `).run(
      versionId,
      agentId,
      defaultPrompt,
      JSON.stringify({
        company_context: defaultCompanyContext,
        handoff_rules: "Derivar si piden hablar con un humano o solicitan descuentos especiales fuera de catálogo."
      }),
      JSON.stringify({ custom_instructions: "" })
    );

    // 3. Now link active_version_id on sdr_agents
    db.prepare("UPDATE sdr_agents SET active_version_id = ? WHERE id = ?").run(versionId, agentId);

    // 4. Seed initial knowledge source
    try {
      db.prepare(`
        INSERT INTO sdr_knowledge_sources (
          id, agent_id, status, title, source_type, metadata_json
        ) VALUES (?, ?, 'approved', 'Catálogo de Servicios InHubFlow', 'catalog', ?)
      `).run(randomUUID(), agentId, JSON.stringify({ content: defaultCompanyContext }));
    } catch {}

    agent = db.prepare("SELECT * FROM sdr_agents WHERE id = ?").get(agentId) as any;
  }

  let activeVersion: any = null;
  if (agent?.active_version_id) {
    activeVersion = db.prepare("SELECT * FROM sdr_agent_versions WHERE id = ?").get(agent.active_version_id);
  }
  if (!activeVersion && agent?.id) {
    activeVersion = db.prepare("SELECT * FROM sdr_agent_versions WHERE agent_id = ? ORDER BY version_number DESC LIMIT 1").get(agent.id);
  }

  return { agent, activeVersion };
}
