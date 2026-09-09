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
    return res.status(400).json({ error: "El Código de Conexión es obligatorio" });
  }

  const rawInput = li_at.trim();
  let sessionCookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }> = [];
  let detectedUserAgent: string | undefined;

  // Check if it's the full bundle from InHubFlow Connect (ihf_ + base64)
  if (rawInput.startsWith("ihf_")) {
    try {
      const decodedJson = Buffer.from(rawInput.slice(4), "base64").toString("utf-8");
      const parsed = JSON.parse(decodedJson);
      if (typeof parsed.userAgent === "string" && parsed.userAgent.length > 10) {
        detectedUserAgent = parsed.userAgent;
      }
      if (Array.isArray(parsed.cookies) && parsed.cookies.length > 0) {
        sessionCookies = parsed.cookies.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain?.startsWith(".") ? c.domain : `.${c.domain || "linkedin.com"}`,
          path: c.path || "/",
          httpOnly: c.httpOnly ?? true,
          secure: c.secure ?? true,
          sameSite: (c.sameSite === "None" ? "None" : (c.sameSite === "Strict" ? "Strict" : "Lax")),
        }));
      }
    } catch {
      // Fallback below
    }
  } else if (rawInput.startsWith("[") && rawInput.endsWith("]")) {
    // Cookie-Editor export JSON format
    try {
      const parsed = JSON.parse(rawInput);
      if (Array.isArray(parsed)) {
        sessionCookies = parsed.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain?.startsWith(".") ? c.domain : `.${c.domain || "linkedin.com"}`,
          path: c.path || "/",
          httpOnly: c.httpOnly ?? true,
          secure: c.secure ?? true,
          sameSite: "Lax" as const,
        }));
      }
    } catch {
      // Fallback below
    }
  }

  // If not bundled, parse as raw token
  if (sessionCookies.length === 0) {
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

  // Parse document.cookie string into extra cookie objects if provided
  if (document_cookie) {
    for (const part of document_cookie.split(";")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      const name = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      if (name && value && !sessionCookies.some((c) => c.name === name)) {
        sessionCookies.push({ name, value, domain: ".linkedin.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" });
      }
    }
  }

  // Ensure li_at is present
  const hasLiAt = sessionCookies.some((c) => c.name === "li_at" && c.value && c.value.length > 20);
  if (!hasLiAt) {
    return res.status(400).json({
      error: "El código no contiene un token de sesión li_at válido de LinkedIn.",
    });
  }

  // Build Playwright-compatible storageState
  const storageState: { cookies: typeof sessionCookies; origins: any[]; userAgent?: string } = {
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
