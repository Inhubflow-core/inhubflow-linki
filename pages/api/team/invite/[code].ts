import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = (req.query.code as string)?.trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ error: "Código de invitación requerido." });
  }

  const db = getDb();

  // Find invitation
  const invite = db
    .prepare(`
      SELECT i.id, i.owner_id, i.email, i.role, i.assigned_account_id, i.status, i.expires_at,
             u.company_name as owner_company, u.name as owner_name, u.email as owner_email
      FROM team_invitations i
      JOIN users u ON i.owner_id = u.id
      WHERE i.invite_code = ?
    `)
    .get(code) as any;

  if (!invite) {
    return res.status(404).json({ error: "Invitación no encontrada o código inválido." });
  }

  if (invite.status === "accepted") {
    return res.status(400).json({ error: "Esta invitación ya fue aceptada. Puedes iniciar sesión directamente." });
  }

  if (invite.status === "revoked") {
    return res.status(400).json({ error: "Esta invitación ha sido revocada por el administrador." });
  }

  const isExpired = new Date(invite.expires_at).getTime() < Date.now();
  if (isExpired) {
    return res.status(400).json({ error: "Esta invitación ha expirado. Solicita un nuevo enlace al administrador." });
  }

  // GET: Validate and fetch invitation details for the signup screen
  if (req.method === "GET") {
    return res.status(200).json({
      valid: true,
      email: invite.email,
      role: invite.role,
      company_name: invite.owner_company || invite.owner_name || "InHubFlow Workspace",
      owner_email: invite.owner_email,
    });
  }

  // POST: Complete registration of invited member
  if (req.method === "POST") {
    try {
      const { name, password } = req.body;

      if (!password || password.length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
      }

      // Check if user with this email already exists
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(invite.email) as any;
      if (existing) {
        return res.status(400).json({ error: "Ya existe una cuenta con este correo electrónico." });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const newUserId = randomUUID();

      db.transaction(() => {
        // 1. Create user with owner_id and assigned_account_id
        db.prepare(`
          INSERT INTO users (
            id, name, email, password_hash, role, owner_id, assigned_account_id,
            slots_limit, subscription_status, plan_tier, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'user', ?, ?, 1, 'active', 'starter', datetime('now'), datetime('now'))
        `).run(
          newUserId,
          name ? String(name).trim() : invite.email.split("@")[0],
          invite.email,
          passwordHash,
          invite.owner_id,
          invite.assigned_account_id || null
        );

        // 2. Mark invitation as accepted
        db.prepare("UPDATE team_invitations SET status = 'accepted' WHERE id = ?").run(invite.id);

        // 3. If an account was pre-assigned, bind it
        if (invite.assigned_account_id) {
          db.prepare("UPDATE accounts SET assigned_user_id = ? WHERE id = ?").run(newUserId, invite.assigned_account_id);
        }
      })();

      return res.status(201).json({
        success: true,
        message: "¡Cuenta activada con éxito! Ya puedes ingresar.",
        email: invite.email,
      });
    } catch (err: any) {
      console.error("[Invite Accept error]:", err);
      return res.status(500).json({ error: "Error al registrar cuenta: " + err.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
}
