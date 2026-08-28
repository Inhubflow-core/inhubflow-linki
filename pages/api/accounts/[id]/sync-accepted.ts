import type { NextApiRequest, NextApiResponse } from "next";
import { syncAcceptedConnectionsDetailed } from "@/lib/linkedin/sync-accepted";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) return res.status(400).json({ error: "Missing account id" });

  try {
    const result = await syncAcceptedConnectionsDetailed(accountId);
    if (!result.success) {
      return res.status(result.reason === "account_missing" ? 404 : 503).json({
        ok: false,
        ...result,
        error: `Accepted-connection sync incomplete (${result.reason ?? "unknown"})`,
      });
    }
    return res.json({ ok: true, ...result, newly_accepted: result.stamped });
  } catch (err) {
    console.error("[sync-accepted]", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
}

export const config = {
  api: { responseLimit: false },
};
