import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getInstanceSettings } from "@/lib/auto-seed";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const { slotsLimit, companyName } = getInstanceSettings(db);

  const accountsCount = (db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number })?.count || 0;
  const emailsCount = (db.prepare("SELECT COUNT(*) as count FROM email_accounts").get() as { count: number })?.count || 0;

  return res.json({
    companyName: companyName || "InHubFlow Suite",
    slotsLimit,
    accountsUsed: accountsCount,
    emailsUsed: emailsCount,
    slotsRemaining: Math.max(0, slotsLimit - accountsCount),
    platform: "InHubFlow B2B Suite",
    version: "2026.1",
  });
}
