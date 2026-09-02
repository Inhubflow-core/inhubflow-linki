import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Account not found" });

  const { li_at, document_cookie } = req.body as { li_at?: string; document_cookie?: string };
  if (!li_at || typeof li_at !== "string") {
    return res.status(400).json({ error: "La cookie li_at es obligatoria" });
  }

  const cleanLiAt = li_at.trim();
  if (
    cleanLiAt.includes("copy(") ||
    cleanLiAt.includes("document.cookie") ||
    cleanLiAt.includes("javascript:") ||
    cleanLiAt.includes(" ") ||
    cleanLiAt.length < 20
  ) {
    return res.status(400).json({
      error: "El valor ingresado no es una cookie válida de LinkedIn. Debe ser el token de sesión (normalmente empieza con 'AQED...' o 'AQEE...'). No pegues el texto del script.",
    });
  }

  // Parse document.cookie string into cookie objects
  const extraCookies: { name: string; value: string; domain: string; path: string }[] = [];
  if (document_cookie) {
    for (const part of document_cookie.split(";")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      const name = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      if (name && value) {
        extraCookies.push({ name, value, domain: ".linkedin.com", path: "/" });
      }
    }
  }

  // Build Playwright-compatible storageState
  const storageState = {
    cookies: [
      { name: "li_at", value: li_at.trim(), domain: ".linkedin.com", path: "/", httpOnly: true, secure: true, sameSite: "None" as const },
      ...extraCookies.filter((c) => c.name !== "li_at"),
    ],
    origins: [],
  };

  db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
    encryptSecret(JSON.stringify(storageState)),
    id
  );

  // Evict the cached browser context so next import uses the new cookies
  const { closeSession } = await import("@/lib/linkedin/session");
  await closeSession(id);

  return res.json({ ok: true });
}
