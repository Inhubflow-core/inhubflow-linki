import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { getInstanceSettings } from "@/lib/auto-seed";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const db = getDb();

    // Excludes cookies_json — the frontend never uses the raw session blob, only
    // is_authenticated, so there's no reason to ship it (even encrypted) to the client.
    const ACCOUNT_COLUMNS = `a.id, a.name, a.email, a.is_authenticated, a.daily_connection_limit, a.daily_message_limit, a.daily_inmail_limit,
      a.active_hours_start, a.active_hours_end, a.timezone, a.working_days, a.created_at,
      a.inbox_synced_at, a.accepted_sync_at, a.li_connections, a.li_pending, a.li_profile_views,
      a.li_stats_synced_at, a.connections_synced_through_ms`;

    if (req.method === "GET") {
      const accounts = db.prepare(`
        SELECT ${ACCOUNT_COLUMNS},
          (SELECT COUNT(*) FROM runs r WHERE r.account_id = a.id AND r.status IN ('running', 'paused')) AS active_run_count
        FROM accounts a ORDER BY a.created_at DESC
      `).all();
      return res.json(accounts);
    }

    if (req.method === "POST") {
      const {
        name,
        email,
        daily_connection_limit = 20,
        daily_message_limit = 50,
        daily_inmail_limit = 15,
        active_hours_start = 9,
        active_hours_end = 18,
        timezone = "UTC",
        working_days = "1,2,3,4,5",
      } = req.body;

      if (!name || !email) return res.status(400).json({ error: "Nombre y correo son obligatorios" });

      // Check slots limit
      try {
        const session = await getServerSession(req, res, authOptions);
        const { slotsLimit: instanceLimit } = getInstanceSettings(db);
        const userSlots = (session?.user as { slots_limit?: number; role?: string })?.slots_limit;
        const userRole = (session?.user as { role?: string })?.role;
        const effectiveLimit = userRole === "admin" ? 999 : (userSlots || instanceLimit);

        const countRow = db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number };

        if (countRow && countRow.count >= effectiveLimit) {
          return res.status(403).json({
            error: `Has alcanzado el límite de ${effectiveLimit} slots/cuentas de tu suscripción actual.`,
            slotsLimit: effectiveLimit,
            currentCount: countRow.count,
          });
        }
      } catch (e) {
        console.log("Slot check notice:", e);
      }

      try {
        const id = randomUUID();
        db
          .prepare(
            `INSERT INTO accounts (
              id, name, email, daily_connection_limit, daily_message_limit, daily_inmail_limit,
              active_hours_start, active_hours_end, timezone, working_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            name.trim(),
            email.trim().toLowerCase(),
            daily_connection_limit,
            daily_message_limit,
            daily_inmail_limit,
            active_hours_start,
            active_hours_end,
            timezone,
            working_days
          );
        const account = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a WHERE a.id = ?`).get(id);
        return res.status(201).json(account);
      } catch (dbErr: any) {
        if (dbErr?.message?.includes("UNIQUE constraint failed")) {
          return res.status(409).json({ error: "Este correo de LinkedIn ya está registrado en tus cuentas" });
        }
        return res.status(500).json({ error: dbErr?.message || "Error al insertar cuenta en la base de datos" });
      }
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Error interno del servidor" });
  }
}
