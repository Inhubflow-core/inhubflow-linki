import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { forceRunStep } from "@/lib/linkedin/runner";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const { id } = req.query;
  const runId = Array.isArray(id) ? id[0] : id;
  if (!runId) return res.status(400).json({ error: "Missing run id" });

  const db = getDb();
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(runId);
  if (!run) return res.status(404).json({ error: "Run not found" });

  const { target_id, all } = req.body || {};

  try {
    const result = await forceRunStep(runId, all ? undefined : target_id);
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
