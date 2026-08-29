import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getCampaignLinkedInThread } from "@/lib/linkedin/campaign-inbox";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const targetId = typeof req.query.targetId === "string" ? req.query.targetId.trim() : "";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : undefined;
  const threadId = typeof req.query.threadId === "string" ? req.query.threadId.trim() : undefined;

  if (!targetId) {
    return res.status(400).json({ error: "targetId is required" });
  }

  const db = getDb();
  const messages = getCampaignLinkedInThread(db, targetId, accountId, threadId);

  return res.status(200).json({ ok: true, messages: messages || [] });
}
