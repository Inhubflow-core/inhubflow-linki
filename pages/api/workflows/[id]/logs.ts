import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const workflowId = Array.isArray(id) ? id[0] : id;
  if (!workflowId) return res.status(400).json({ error: "Missing workflow id" });

  const db = getDb();
  const logs = db.prepare(`
    SELECT l.id, l.run_id, l.target_id, l.level, l.message, l.created_at,
           t.full_name as target_name, t.linkedin_url as target_url
    FROM logs l
    JOIN runs r ON r.id = l.run_id
    LEFT JOIN targets t ON t.id = l.target_id
    WHERE r.workflow_id = ?
    ORDER BY l.created_at DESC
    LIMIT 200
  `).all(workflowId);

  return res.json({ logs });
}
