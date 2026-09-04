import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { isRateLimited } from "@/lib/rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // Invite code + password are both guessable secrets — throttle attempts per IP.
  if (isRateLimited(req, "signup", 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many attempts. Try again later." });
  }

  const { email, password, inviteCode } = req.body as {
    email?: string;
    password?: string;
    inviteCode?: string;
  };

  if (!email || !password || !inviteCode) {
    return res.status(400).json({ error: "Email, contraseña y código de invitación son obligatorios." });
  }

  const cleanCode = inviteCode.trim().toUpperCase();
  const cleanEmail = email.trim().toLowerCase();
  const db = getDb();

  // 1. Check if this is a valid team member invitation code (e.g. INV-DZEVS859)
  const teamInvite = db
    .prepare(`
      SELECT id, owner_id, email, role, assigned_account_id, status, expires_at
      FROM team_invitations
      WHERE invite_code = ?
    `)
    .get(cleanCode) as any;

  if (teamInvite) {
    if (teamInvite.status === "accepted") {
      return res.status(400).json({ error: "Esta invitación ya ha sido utilizada. Puedes iniciar sesión directamente." });
    }
    if (teamInvite.status === "revoked") {
      return res.status(400).json({ error: "Esta invitación ha sido revocada por el administrador." });
    }
    const isExpired = new Date(teamInvite.expires_at).getTime() < Date.now();
    if (isExpired) {
      return res.status(400).json({ error: "Esta invitación ha expirado. Solicita un nuevo enlace." });
    }
    if (teamInvite.email && teamInvite.email.toLowerCase() !== cleanEmail) {
      return res.status(400).json({ error: `Este código de invitación pertenece al correo ${teamInvite.email}` });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
    }

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: "Ya existe una cuenta con este correo electrónico." });
    }

    const hash = await bcrypt.hash(password, 10);
    const newUserId = randomUUID();

    db.transaction(() => {
      // Create invited user linked to owner
      db.prepare(`
        INSERT INTO users (
          id, name, email, password_hash, role, owner_id, assigned_account_id,
          slots_limit, subscription_status, plan_tier, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'user', ?, ?, 1, 'active', 'starter', datetime('now'), datetime('now'))
      `).run(
        newUserId,
        cleanEmail.split("@")[0],
        cleanEmail,
        hash,
        teamInvite.owner_id,
        teamInvite.assigned_account_id || null
      );

      // Mark invitation accepted
      db.prepare("UPDATE team_invitations SET status = 'accepted' WHERE id = ?").run(teamInvite.id);

      // Link assigned account if any
      if (teamInvite.assigned_account_id) {
        db.prepare("UPDATE accounts SET assigned_user_id = ? WHERE id = ?").run(newUserId, teamInvite.assigned_account_id);
      }
    })();

    return res.status(201).json({ ok: true, message: "Cuenta activada con éxito." });
  }

  // 2. Fallback to system instance AUTH_PASSWORD master invite code
  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return res.status(403).json({ error: "Código de invitación inválido o no reconocido." });
  }

  if (inviteCode !== authPassword) {
    return res.status(403).json({ error: "Código de invitación inválido." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: "Ya existe una cuenta con este correo electrónico." });
  }

  const hash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(randomUUID(), cleanEmail, hash);

  return res.status(201).json({ ok: true });
}
