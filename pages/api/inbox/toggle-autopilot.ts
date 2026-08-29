import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const targetId = req.body?.targetId || req.query.targetId;
  if (!targetId || typeof targetId !== "string") {
    return res.status(400).json({ error: "Missing targetId" });
  }

  const db = getDb();
  const current = db.prepare("SELECT id, sdr_autopilot, full_name FROM targets WHERE id = ?").get(targetId) as
    | { id: string; sdr_autopilot?: number; full_name?: string }
    | undefined;

  if (!current) return res.status(404).json({ error: "Target not found" });

  const explicitEnabled = req.body?.enabled;
  const nextVal = typeof explicitEnabled === "boolean"
    ? (explicitEnabled ? 1 : 0)
    : (current.sdr_autopilot === 1 ? 0 : 1);

  db.prepare("UPDATE targets SET sdr_autopilot = ? WHERE id = ?").run(nextVal, targetId);

  return res.status(200).json({
    ok: true,
    targetId,
    sdr_autopilot: nextVal,
    message: nextVal === 1
      ? `Piloto Automático activado para ${current.full_name || "el prospecto"}.`
      : `Piloto Automático desactivado para ${current.full_name || "el prospecto"}.`,
  });
}
