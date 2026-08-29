import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { GeminiSdrProvider } from "@/lib/sdr-agent/gemini";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { targetId, lastMessage, history } = req.body ?? {};

  if (!targetId) {
    return res.status(400).json({ error: "Missing targetId" });
  }

  const db = getDb();
  const target = db.prepare("SELECT id, full_name, company, position, email, linkedin_url FROM targets WHERE id = ?").get(targetId) as
    | { id: string; full_name: string; company?: string; position?: string; email?: string; linkedin_url?: string }
    | undefined;

  const targetName = target?.full_name || "Prospecto";
  const firstName = targetName.split(" ")[0];
  const inboundText = lastMessage || "";

  // Load SDR Agent config and knowledge from DB
  let companyContext: string | undefined;
  let customInstructions: string | undefined;
  try {
    const agent = db.prepare("SELECT id, active_version_id FROM sdr_agents ORDER BY created_at ASC LIMIT 1").get() as { id: string; active_version_id: string } | undefined;
    if (agent?.active_version_id) {
      const version = db.prepare("SELECT policy_json, config_json, system_prompt FROM sdr_agent_versions WHERE id = ?").get(agent.active_version_id) as { policy_json: string; config_json: string; system_prompt: string } | undefined;
      if (version) {
        const policy = JSON.parse(version.policy_json || "{}");
        const config = JSON.parse(version.config_json || "{}");
        companyContext = policy.company_context || version.system_prompt;
        customInstructions = config.custom_instructions;
      }
    }
    const sources = db.prepare("SELECT title, metadata_json FROM sdr_knowledge_sources WHERE status = 'approved'").all() as Array<{ title: string; metadata_json: string }>;
    if (sources.length > 0) {
      const knowledgeTexts = sources.map(s => {
        try {
          const m = JSON.parse(s.metadata_json);
          return `### ${s.title}\n${m.content || ""}`;
        } catch { return `### ${s.title}`; }
      }).join("\n\n");
      companyContext = (companyContext ? `${companyContext}\n\n=== BASE DE CONOCIMIENTO DE LA EMPRESA ===\n` : "=== BASE DE CONOCIMIENTO DE LA EMPRESA ===\n") + knowledgeTexts;
    }
  } catch { /* ignore */ }

  // 1. If GEMINI_API_KEY is available, use GeminiSdrProvider
  if (process.env.GEMINI_API_KEY) {
    try {
      const provider = new GeminiSdrProvider();
      const decision = await provider.classifyAndDraft({
        senderName: targetName,
        inboundMessage: inboundText,
        conversationHistory: Array.isArray(history) ? history : [],
        companyContext,
        customInstructions,
      });

      return res.status(200).json({
        ok: true,
        suggestedReply: decision.reply_draft || `¡Hola ${firstName}! Gracias por tu mensaje. ¿Te gustaría que tengamos una breve llamada de 15 minutos para conversar sobre cómo podemos ayudarte?`,
        intent: decision.intent,
        reasoning: decision.reasoning_summary,
      });
    } catch (err) {
      console.warn("[suggest-reply] Gemini provider error:", err);
      // Fallback to contextual heuristic if Gemini API error occurs
    }
  }

  // 2. Fallback heuristic response generator
  const lower = inboundText.toLowerCase();
  let suggested = `¡Hola ${firstName}! Muchas gracias por responder. ¿Te gustaría coordinar una breve llamada de 15 minutos para ver cómo InHubFlow puede potenciar tus resultados comerciales?`;

  if (lower.includes("precio") || lower.includes("costo") || lower.includes("cuanto") || lower.includes("valor")) {
    suggested = `¡Hola ${firstName}! Contamos con planes flexibles adaptados al tamaño de tu equipo y volumen de prospección. Con gusto te muestro una comparativa rápida en una llamada de 10 minutos. ¿Qué día te vendría bien?`;
  } else if (lower.includes("no") && (lower.includes("interesa") || lower.includes("gracias") || lower.includes("momento"))) {
    suggested = `¡Hola ${firstName}! Entiendo perfectamente. Te agradezco la sinceridad y quedamos en contacto por aquí para cuando lo consideres oportuno. ¡Muchos éxitos!`;
  } else if (lower.includes("como funciona") || lower.includes("info") || lower.includes("mas") || lower.includes("explicar")) {
    suggested = `¡Hola ${firstName}! InHubFlow te permite automatizar la prospección multicanal y delegar en IA el seguimiento de tus prospectos. Si te parece, te comparto una demo interactiva o lo vemos en 15 minutos. ¿Te queda bien esta semana?`;
  }

  return res.status(200).json({
    ok: true,
    suggestedReply: suggested,
    intent: "inquiry",
    reasoning: "Contextual heuristic response",
  });
}
