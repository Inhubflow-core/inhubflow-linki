import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getCampaignLinkedInThread } from "@/lib/linkedin/campaign-inbox";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const targetId = typeof req.query.targetId === "string" ? req.query.targetId.trim() : "";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : "";
  const threadId = typeof req.query.threadId === "string" ? req.query.threadId.trim() : "";
  if (!targetId || !accountId || !threadId) {
    return res.status(400).json({ error: "targetId, accountId, and threadId are required" });
  }

  const db = getDb();
  const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId);
  if (!account) return res.status(404).json({ error: "LinkedIn account not found" });

  const messages = getCampaignLinkedInThread(db, targetId, accountId, threadId);
  if (!messages) return res.status(404).json({ error: "Campaign LinkedIn thread not found" });
  return res.status(200).json({ messages });
}
