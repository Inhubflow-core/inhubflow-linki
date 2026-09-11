import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) return res.status(400).json({ error: "Missing account id" });

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) {
    return res.status(404).json({ error: "LinkedIn account not found" });
  }

  const account = db.prepare("SELECT id, name, email, is_authenticated, extension_active, last_extension_ping_at FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; name: string | null; email: string; is_authenticated: number; extension_active: number; last_extension_ping_at: string | null }
    | undefined;

  if (!account) return res.status(404).json({ error: "LinkedIn account not found" });

  return res.status(200).json({
    ok: true,
    account: {
      name: account.name || account.email,
      email: account.email,
      is_authenticated: account.is_authenticated,
      extension_active: account.extension_active,
      last_extension_ping_at: account.last_extension_ping_at,
    },
    browser: {
      screenshot: null,
      status: "Extension Active (Residential IP)",
    },
  });
}
