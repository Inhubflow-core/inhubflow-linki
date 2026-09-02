import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const db = getDb();
  const userEmail = session.user.email?.trim().toLowerCase();
  let userRole = (session.user as { role?: string })?.role || "user";

  // InHubFlow SuperAdmin guarantee
  if (userEmail === "inhubflow@gmail.com") {
    userRole = "admin";
  }

  // Fallback: check if this user is admin or the first user in DB
  if (userRole !== "admin" && userEmail) {
    try {
      const userRow = db.prepare("SELECT id, role FROM users WHERE email = ?").get(userEmail) as { id: string; role?: string } | undefined;
      const firstUser = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
      if (userRow && (userRow.role === "admin" || (firstUser && firstUser.id === userRow.id))) {
        db.prepare("UPDATE users SET role = 'admin', slots_limit = 999 WHERE id = ?").run(userRow.id);
        userRole = "admin";
      }
    } catch {}
  }

  if (userRole !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de SuperAdmin." });
  }

  if (req.method === "GET") {
    try {
      const users = db
        .prepare(
          `SELECT 
            id, 
            email, 
            role, 
            company_name, 
            slots_limit, 
            subscription_status, 
            plan_tier, 
            paddle_customer_id, 
            paddle_subscription_id, 
            created_at, 
            updated_at 
          FROM users 
          ORDER BY created_at DESC`
        )
        .all();

      const totalAccountsRow = db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number };
      const totalAccounts = totalAccountsRow?.count || 0;

      let totalSlotsAllocated = 0;
      let activeSubscriptions = 0;

      for (const u of users as Array<{ slots_limit?: number; subscription_status?: string }>) {
        totalSlotsAllocated += u.slots_limit || 1;
        if (u.subscription_status === "active") activeSubscriptions++;
      }

      return res.status(200).json({
        subscribers: users,
        stats: {
          totalSubscribers: users.length,
          activeSubscriptions,
          totalSlotsAllocated,
          totalConnectedAccounts: totalAccounts,
        },
      });
    } catch (err: unknown) {
      console.error("[admin/subscribers] GET Error:", err);
      return res.status(500).json({ error: "Error al obtener lista de suscriptores" });
    }
  }

  if (req.method === "PUT") {
    try {
      const { id, slots_limit, subscription_status, plan_tier, company_name } = req.body as {
        id?: string;
        slots_limit?: number;
        subscription_status?: string;
        plan_tier?: string;
        company_name?: string;
      };

      if (!id) {
        return res.status(400).json({ error: "ID de usuario requerido" });
      }

      const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
      if (!existing) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const newSlots = typeof slots_limit === "number" ? Math.max(1, slots_limit) : 1;
      const validStatuses = ["active", "trial", "past_due", "canceled"];
      const newStatus = validStatuses.includes(subscription_status || "") ? subscription_status : "active";
      const validPlans = ["starter", "growth", "scale", "custom"];
      const newPlan = validPlans.includes(plan_tier || "") ? plan_tier : "starter";

      db.prepare(
        `UPDATE users 
         SET slots_limit = ?, subscription_status = ?, plan_tier = ?, company_name = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(newSlots, newStatus, newPlan, company_name || null, id);

      // Log manual adjustment
      db.prepare(
        `INSERT INTO subscription_logs (id, user_id, event_type, plan_tier, slots, payload_json)
         VALUES (?, ?, 'admin_manual_override', ?, ?, ?)`
      ).run(
        randomUUID(),
        id,
        newPlan,
        newSlots,
        JSON.stringify({
          updated_by: session.user.email,
          new_slots: newSlots,
          new_status: newStatus,
          new_plan: newPlan,
        })
      );

      const updated = db.prepare("SELECT id, email, role, company_name, slots_limit, subscription_status, plan_tier, updated_at FROM users WHERE id = ?").get(id);

      return res.status(200).json({ ok: true, user: updated });
    } catch (err: unknown) {
      console.error("[admin/subscribers] PUT Error:", err);
      return res.status(500).json({ error: "Error al actualizar suscriptor" });
    }
  }

  if (req.method === "POST") {
    try {
      const { email, password, company_name, slots_limit, plan_tier } = req.body as {
        email?: string;
        password?: string;
        company_name?: string;
        slots_limit?: number;
        plan_tier?: string;
      };

      if (!email || !password) {
        return res.status(400).json({ error: "Email y contraseña son obligatorios" });
      }

      const cleanEmail = email.trim().toLowerCase();
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail);
      if (existing) {
        return res.status(409).json({ error: "Ya existe un usuario con este correo" });
      }

      const hash = bcrypt.hashSync(password, 10);
      const newId = randomUUID();
      const initialSlots = typeof slots_limit === "number" ? Math.max(1, slots_limit) : 1;
      const initialPlan = plan_tier || (initialSlots === 1 ? "starter" : initialSlots === 5 ? "growth" : initialSlots === 10 ? "scale" : "custom");

      db.prepare(
        `INSERT INTO users (id, email, password_hash, role, company_name, slots_limit, subscription_status, plan_tier)
         VALUES (?, ?, ?, 'user', ?, ?, 'active', ?)`
      ).run(newId, cleanEmail, hash, company_name || null, initialSlots, initialPlan);

      // Log creation
      db.prepare(
        `INSERT INTO subscription_logs (id, user_id, customer_email, event_type, plan_tier, slots, payload_json)
         VALUES (?, ?, ?, 'admin_manual_create', ?, ?, ?)`
      ).run(
        randomUUID(),
        newId,
        cleanEmail,
        initialPlan,
        initialSlots,
        JSON.stringify({ created_by: session.user.email })
      );

      const created = db.prepare("SELECT id, email, role, company_name, slots_limit, subscription_status, plan_tier, created_at FROM users WHERE id = ?").get(newId);

      return res.status(201).json({ ok: true, user: created });
    } catch (err: unknown) {
      console.error("[admin/subscribers] POST Error:", err);
      return res.status(500).json({ error: "Error al crear nuevo suscriptor" });
    }
  }

  return res.status(405).json({ error: "Método no permitido" });
}
