import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { captureCampaignInboxObservations, loadCampaignTargetScopes, type CampaignInboxObservation } from "@/lib/linkedin/campaign-inbox";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();
  const { accountId, observations } = req.body || {};

  if (!accountId) {
    return res.status(400).json({ error: "Missing accountId" });
  }

  const account = db.prepare("SELECT id, is_authenticated, extension_active FROM accounts WHERE id = ?").get(accountId) as { id: string; is_authenticated: number } | undefined;
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }

  // Auto-heal authenticated status
  db.prepare(`
    UPDATE accounts 
    SET is_authenticated = 1, 
        extension_active = 1,
        linkedin_inbox_synced_at = datetime('now')
    WHERE id = ?
  `).run(accountId);

  if (!Array.isArray(observations) || observations.length === 0) {
    return res.json({ ok: true, captured: 0, duplicates: 0, skipped: [] });
  }

  try {
    const scopes = loadCampaignTargetScopes(db, accountId);
    const result = captureCampaignInboxObservations(db, accountId, observations as CampaignInboxObservation[], scopes);
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("[api/extension/inbox-sync] Error capturing inbox observations:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to capture observations" });
  }
}
