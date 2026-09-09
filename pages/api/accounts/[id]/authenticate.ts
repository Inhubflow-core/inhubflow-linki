import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import {
  dedupeLinkedInCookies,
  hasValidLinkedInLiAt,
  normalizeLinkedInCookie,
  normalizeLinkedInCookieList,
  type LinkedInSessionCookie,
} from "@/lib/linkedin/cookie-state";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Account not found" });

  const body = (req.body ?? {}) as { li_at?: unknown; document_cookie?: unknown };
  if (typeof body.li_at !== "string" || !body.li_at.trim()) {
    return res.status(400).json({ error: "El Código de Conexión es obligatorio" });
  }

  const rawInput = body.li_at.trim();
  let sessionCookies: LinkedInSessionCookie[] = [];
  let detectedUserAgent: string | undefined;
  let structuredInput = false;

  // Full bundle from InHubFlow Connect (ihf_ + base64)
  if (rawInput.startsWith("ihf_")) {
    structuredInput = true;
    try {
      const decodedJson = Buffer.from(rawInput.slice(4), "base64").toString("utf-8");
      const parsed = JSON.parse(decodedJson) as Record<string, unknown>;
      if (typeof parsed.userAgent === "string" && parsed.userAgent.length > 10) {
        detectedUserAgent = parsed.userAgent;
      }
      const normalized = normalizeLinkedInCookieList(parsed.cookies, { domain: ".linkedin.com", httpOnly: true });
      if (!normalized || normalized.length === 0) throw new Error("Bundle cookies are invalid");
      sessionCookies = dedupeLinkedInCookies(normalized);
      if (!hasValidLinkedInLiAt(sessionCookies) && typeof parsed.li_at === "string" && parsed.li_at.length > 20) {
        sessionCookies.unshift(normalizeLinkedInCookie({
          name: "li_at",
          value: parsed.li_at,
          domain: ".linkedin.com",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        })!);
      }
    } catch {
      return res.status(400).json({
        error: "El Código de Conexión de la extensión está dañado o no contiene cookies válidas de LinkedIn.",
      });
    }
  } else if (rawInput.startsWith("[") && rawInput.endsWith("]")) {
    // Cookie-Editor export JSON format
    structuredInput = true;
    try {
      const parsed = JSON.parse(rawInput);
      const normalized = normalizeLinkedInCookieList(parsed, { domain: ".linkedin.com", httpOnly: false });
      if (!normalized || normalized.length === 0) throw new Error("Cookie export is invalid");
      sessionCookies = dedupeLinkedInCookies(normalized);
    } catch {
      return res.status(400).json({
        error: "La exportación de cookies no es válida. Vuelve a copiar las cookies de LinkedIn.",
      });
    }
  }

  // Raw li_at token (legacy support)
  if (sessionCookies.length === 0 && !structuredInput) {
    if (
      rawInput.includes("copy(") ||
      rawInput.includes("document.cookie") ||
      rawInput.includes("javascript:") ||
      rawInput.includes(" ") ||
      rawInput.length < 20
    ) {
      return res.status(400).json({
        error: "El valor ingresado no es un Código de Conexión válido de LinkedIn. Asegúrate de copiarlo desde la extensión InHubFlow Connect.",
      });
    }

    sessionCookies.push({
      name: "li_at",
      value: rawInput,
      domain: ".linkedin.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
  }

  // Legacy document.cookie values are additive only and are never httpOnly.
  if (typeof body.document_cookie === "string") {
    for (const part of body.document_cookie.split(";")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      const cookie = normalizeLinkedInCookie({
        name: part.slice(0, eqIdx).trim(),
        value: part.slice(eqIdx + 1).trim(),
        domain: ".linkedin.com",
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      });
      if (cookie && !sessionCookies.some((existing) => existing.name === cookie.name)) {
        sessionCookies.push(cookie);
      }
    }
  }

  if (!hasValidLinkedInLiAt(sessionCookies)) {
    return res.status(400).json({
      error: "El código no contiene un token de sesión li_at válido de LinkedIn.",
    });
  }

  // Build Playwright-compatible storageState
  const storageState: { cookies: typeof sessionCookies; origins: unknown[]; userAgent?: string } = {
    cookies: sessionCookies,
    origins: [],
  };
  if (detectedUserAgent) {
    storageState.userAgent = detectedUserAgent;
  }

  db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
    encryptSecret(JSON.stringify(storageState)),
    id
  );

  // Evict the cached browser context so next import uses the new cookies
  const { closeSession } = await import("@/lib/linkedin/session");
  await closeSession(id);

  return res.json({ ok: true });
}
