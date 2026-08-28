import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { syncAcceptedConnectionsDetailed } from "@/lib/linkedin/sync-accepted";

// POST /api/lists/[id]/sync-status body: { account_id: string }
// Reconciles accepted connections from LinkedIn's authoritative connections API.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const accountId = typeof req.body?.account_id === "string" ? req.body.account_id.trim() : "";
  if (!accountId) return res.status(400).json({ error: "account_id required" });

  try {
    const result = await syncAcceptedConnectionsDetailed(accountId);
    if (!result.success) {
      return res.status(result.reason === "account_missing" ? 404 : 503).json({
        ok: false,
        ...result,
        error: `Connection sync incomplete (${result.reason ?? "unknown"})`,
      });
    }
    return res.json({
      ok: true,
      ...result,
      updated: result.stamped,
      total: result.connectionsRead,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}

export const config = {
  api: { responseLimit: false },
};
