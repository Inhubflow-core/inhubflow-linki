import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor, canManageSdrAgent } from "@/lib/authz";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";
import { simulateSdrDecision } from "@/lib/sdr-agent/simulation";
import type { SdrConversationMessage } from "@/lib/sdr-agent/providers/provider";

interface SimulationBody {
  message?: unknown;
  senderName?: unknown;
  history?: unknown;
  useLiveProvider?: unknown;
}

function parseHistory(value: unknown): SdrConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-20).flatMap((item): SdrConversationMessage[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (
      (candidate.direction !== "inbound" && candidate.direction !== "outbound" && candidate.direction !== "system") ||
      typeof candidate.body !== "string" || candidate.body.length > 5_000
    ) return [];
    return [{
      direction: candidate.direction,
      body: candidate.body,
      sentAt: typeof candidate.sentAt === "string" ? candidate.sentAt : undefined,
    }];
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();
  const { agent } = ensureSdrAgent(db, actor.workspaceOwnerId);
  if (!canManageSdrAgent(db, actor, agent.id)) return res.status(403).json({ error: "No autorizado para usar el simulador SDR" });

  const body = (req.body ?? {}) as SimulationBody;
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 20_000) {
    return res.status(400).json({ error: "El mensaje debe contener entre 1 y 20000 caracteres" });
  }

  try {
    const result = await simulateSdrDecision(db, {
      workspaceOwnerId: actor.workspaceOwnerId,
      message: body.message.trim(),
      senderName: typeof body.senderName === "string" ? body.senderName.slice(0, 500) : null,
      history: parseHistory(body.history),
      useLiveProvider: body.useLiveProvider === true,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error en la simulación SDR";
    if (message === "Live SDR simulation is disabled") {
      return res.status(409).json({ error: "La simulación live está desactivada; usa el provider de prueba o habilítala explícitamente." });
    }
    return res.status(500).json({ error: message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };
