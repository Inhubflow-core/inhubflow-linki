import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();
  let accountId = (req.headers["x-account-id"] || req.query.account_id || req.body?.account_id) as string | undefined;

  // Auto-identification by LinkedIn token if accountId is missing
  const token = (req.headers["x-linkedin-token"] || req.body?.li_at || req.query?.li_at) as string | undefined;
  if (!accountId && token && token.length > 20) {
    const allAccounts = db.prepare("SELECT id, cookies_json FROM accounts WHERE is_authenticated = 1").all() as any[];
    for (const a of allAccounts) {
      if (!a.cookies_json) continue;
      const dec = decryptSecret(a.cookies_json);
      if (dec && dec.includes(token.trim())) {
        accountId = a.id;
        break;
      }
    }
  }

  if (accountId) {
    try {
      db.prepare(`
        UPDATE accounts 
        SET extension_active = 1, 
            last_extension_ping_at = datetime('now') 
        WHERE id = ? OR email = ?
      `).run(accountId, accountId);
    } catch {
      // Non-blocking
    }
  }

  return res.json({
    ok: true,
    accountId: accountId || null,
    serverTime: new Date().toISOString(),
    status: "active",
  });
}
