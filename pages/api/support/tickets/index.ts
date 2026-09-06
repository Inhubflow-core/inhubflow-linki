import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const db = getDb();
  const sessionUser = session.user as { id?: string; email?: string; name?: string; role?: string };
  const userEmail = sessionUser.email?.trim().toLowerCase() || "";
  let userRole = sessionUser.role || "user";

  if (userEmail === "inhubflow@gmail.com") {
    userRole = "admin";
  }

  // Check DB role
  let dbUser: { id: string; name?: string; company_name?: string; role?: string } | undefined;
  try {
    dbUser = db.prepare("SELECT id, name, company_name, role FROM users WHERE email = ?").get(userEmail) as { id: string; name?: string; company_name?: string; role?: string } | undefined;
    if (dbUser?.role === "admin") {
      userRole = "admin";
    }
  } catch {}

  const userId = dbUser?.id || sessionUser.id || "";
  const isAdmin = userRole === "admin";

  if (req.method === "GET") {
    try {
      const { all, status, search } = req.query;

      let query = `
        SELECT 
          t.*,
          (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) as message_count,
          (SELECT m.created_at FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) as latest_message_at
        FROM support_tickets t
      `;
      const params: any[] = [];
      const conditions: string[] = [];

      // Only admin with all=true can see everyone's tickets
      if (!isAdmin || all !== "true") {
        conditions.push("(t.user_id = ? OR t.user_email = ?)");
        params.push(userId, userEmail);
      }

      if (status && status !== "all") {
        conditions.push("t.status = ?");
        params.push(status);
      }

      if (search && typeof search === "string" && search.trim()) {
        conditions.push("(t.subject LIKE ? OR t.user_email LIKE ? OR t.company_name LIKE ? OR CAST(t.ticket_number AS TEXT) LIKE ?)");
        const term = `%${search.trim()}%`;
        params.push(term, term, term, term);
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += " ORDER BY t.updated_at DESC";

      const tickets = db.prepare(query).all(...params);

      // Summary counts for dashboard / admin
      let counts = { total: 0, open: 0, in_progress: 0, resolved: 0, closed: 0 };
      try {
        if (isAdmin && all === "true") {
          const rows = db.prepare("SELECT status, COUNT(*) as count FROM support_tickets GROUP BY status").all() as Array<{ status: string; count: number }>;
          rows.forEach((r) => {
            if (r.status in counts) {
              (counts as any)[r.status] = r.count;
            }
            counts.total += r.count;
          });
        }
      } catch {}

      return res.status(200).json({ tickets, counts });
    } catch (err: any) {
      console.error("[Support API] GET error:", err);
      return res.status(500).json({ error: "Error al cargar tickets", details: err?.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { subject, category = "general", priority = "normal", message } = req.body;

      if (!subject || typeof subject !== "string" || !subject.trim()) {
        return res.status(400).json({ error: "El asunto es obligatorio" });
      }

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "El mensaje detallado es obligatorio" });
      }

      const ticketId = randomUUID();
      const messageId = randomUUID();

      // Next ticket number
      const maxRow = db.prepare("SELECT COALESCE(MAX(ticket_number), 1000) as maxNum FROM support_tickets").get() as { maxNum: number };
      const nextTicketNumber = (maxRow?.maxNum || 1000) + 1;

      const userName = dbUser?.name || sessionUser.name || userEmail.split("@")[0];
      const companyName = dbUser?.company_name || "";

      // Transaction: create ticket and initial message
      const createTx = db.transaction(() => {
        db.prepare(`
          INSERT INTO support_tickets (
            id, ticket_number, user_id, user_email, user_name, company_name, 
            subject, category, priority, status, created_at, updated_at, last_reply_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'), datetime('now'), datetime('now'))
        `).run(
          ticketId,
          nextTicketNumber,
          userId,
          userEmail,
          userName,
          companyName,
          subject.trim(),
          category,
          priority
        );

        db.prepare(`
          INSERT INTO support_ticket_messages (
            id, ticket_id, sender_id, sender_email, sender_role, sender_name, message, created_at
          ) VALUES (?, ?, ?, ?, 'user', ?, ?, datetime('now'))
        `).run(
          messageId,
          ticketId,
          userId,
          userEmail,
          userName,
          message.trim()
        );
      });

      createTx();

      // Optional email alert to admin via Resend if key is available
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        try {
          const fromEmail = process.env.RESEND_FROM_EMAIL || "InHubFlow Soporte <info@inhubflow.online>";
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              from: fromEmail,
              to: ["inhubflow@gmail.com"],
              subject: `[Nuevo Ticket #TCK-${nextTicketNumber}] ${subject.trim()}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
                  <h2 style="color: #4f46e5; margin-top: 0;">Nuevo Ticket de Soporte (#TCK-${nextTicketNumber})</h2>
                  <p><strong>Cliente:</strong> ${userName} (${userEmail})</p>
                  <p><strong>Empresa:</strong> ${companyName || 'No especificada'}</p>
                  <p><strong>Categoría:</strong> ${category} | <strong>Prioridad:</strong> ${priority}</p>
                  <p><strong>Asunto:</strong> ${subject.trim()}</p>
                  <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 15px 0;" />
                  <p style="white-space: pre-wrap; background: #f9fafb; padding: 12px; border-radius: 8px;">${message.trim()}</p>
                  <div style="margin-top: 20px;">
                    <a href="https://b2b.inhubflow.online/admin" style="background: #4f46e5; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 13px;">
                      Ver y Responder en el Panel Admin
                    </a>
                  </div>
                </div>
              `,
            }),
          });
        } catch (mailErr) {
          console.warn("[Support API] Error al enviar email de alerta a admin:", mailErr);
        }
      }

      return res.status(201).json({
        success: true,
        ticket: {
          id: ticketId,
          ticket_number: nextTicketNumber,
          subject: subject.trim(),
          status: "open",
        },
      });
    } catch (err: any) {
      console.error("[Support API] POST error:", err);
      return res.status(500).json({ error: "Error al crear ticket", details: err?.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Método no permitido" });
}
