import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import {
  campaignInboxContractVersion,
  syncLinkedInCampaignInbox,
} from "@/lib/linkedin/campaign-inbox";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) return res.status(400).json({ error: "Missing account id" });

  const db = getDb();
  const account = db.prepare("SELECT id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number }
    | undefined;
  if (!account) return res.status(404).json({ error: "LinkedIn account not found" });
  if (account.is_authenticated !== 1) return res.status(400).json({ error: "Account not authenticated" });

  const contractVersion = campaignInboxContractVersion();
  if (!contractVersion) {
    return res.status(409).json({
      ok: false,
      contract_status: "unverified",
      error: "LinkedIn inbox contract is not verified. Set the verified contract flag only after completing the authorized observation gate.",
    });
  }

  try {
    const result = await syncLinkedInCampaignInbox(accountId, {
      db,
      allowWhenSchedulerDisabled: true,
      contractVersion,
    });
    if (result.reason && !result.success) {
      return res.status(result.reason === "auth_wall" || result.reason === "api_error" ? 503 : 409).json({
        ok: false,
        contract_status: contractVersion,
        ...result,
      });
    }
    return res.status(200).json({
      ok: true,
      contract_status: contractVersion,
      ...result,
    });
  } catch (error) {
    console.error("[sync-linkedin-inbox]", error);
    return res.status(500).json({
      ok: false,
      contract_status: contractVersion,
      error: error instanceof Error ? error.message : "LinkedIn inbox sync failed",
    });
  }
}

export const config = {
  api: { responseLimit: false },
};
