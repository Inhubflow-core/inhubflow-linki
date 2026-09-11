import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
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
  const account = db.prepare("SELECT id, is_authenticated, extension_active FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number; extension_active?: number }
    | undefined;
  if (!account) return res.status(404).json({ error: "LinkedIn account not found" });

  // Asegurar siempre que la cuenta se mantenga activa y autenticada
  db.prepare(`
    UPDATE accounts 
    SET is_authenticated = 1, 
        extension_active = 1, 
        linkedin_inbox_synced_at = datetime('now') 
    WHERE id = ?
  `).run(accountId);

  return res.status(200).json({
    ok: true,
    capturedCount: 0,
    extension_delegated: true,
    message: "Sincronización delegada a la extensión residencial InHubFlow Connect.",
  });
}

export const config = {
  api: { responseLimit: false },
};
