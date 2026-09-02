import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { GeminiSdrProvider } from "@/lib/sdr-agent/gemini";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, senderName, systemPrompt, companyContext, customInstructions } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "El mensaje es obligatorio" });
    }

    const db = getDb();
    const { agent, activeVersion } = ensureSdrAgent(db);

    let policy = { company_context: "", handoff_rules: "" };
    let config = { custom_instructions: "" };
    try {
      if (activeVersion?.policy_json) policy = JSON.parse(activeVersion.policy_json);
      if (activeVersion?.config_json) config = JSON.parse(activeVersion.config_json);
    } catch {}

    const resolvedCompanyContext = companyContext ?? policy.company_context ?? "";
    const resolvedCustomInstructions = customInstructions ?? config.custom_instructions ?? "";
    const modelName = agent?.model || process.env.GEMINI_MODEL || "gemini-3.6-flash";

    const startTime = Date.now();
    const provider = new GeminiSdrProvider(process.env.GEMINI_API_KEY, modelName);

    const decision = await provider.classifyAndDraft({
      inboundMessage: message,
      senderName: senderName || "Prospecto de Prueba",
      companyContext: resolvedCompanyContext,
      customInstructions: resolvedCustomInstructions,
    });

    const latencyMs = Date.now() - startTime;

    return res.status(200).json({
      ok: true,
      decision,
      latencyMs,
      model: modelName,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Error en la simulación con Gemini" });
  }
}
