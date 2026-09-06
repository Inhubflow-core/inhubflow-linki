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

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "ID de ticket no válido" });
  }

  const db = getDb();
  const sessionUser = session.user as { id?: string; email?: string; name?: string; role?: string };
  const userEmail = sessionUser.email?.trim().toLowerCase() || "";
  let userRole = sessionUser.role || "user";

  if (userEmail === "inhubflow@gmail.com") {
    userRole = "admin";
  }

  let dbUser: { id: string; name?: string; company_name?: string; role?: string } | undefined;
  try {
    dbUser = db.prepare("SELECT id, name, company_name, role FROM users WHERE email = ?").get(userEmail) as { id: string; name?: string; company_name?: string; role?: string } | undefined;
    if (dbUser?.role === "admin") {
      userRole = "admin";
    }
  } catch {}

  const userId = dbUser?.id || sessionUser.id || "";
  const isAdmin = userRole === "admin";

  // Check ticket existence
  const ticket = db.prepare("SELECT * FROM support_tickets WHERE id = ?").get(id) as any;
  if (!ticket) {
    return res.status(404).json({ error: "Ticket no encontrado" });
  }

  // Authorization check: only ticket owner or admin
  if (!isAdmin && ticket.user_id !== userId && ticket.user_email !== userEmail) {
    return res.status(403).json({ error: "Acceso denegado a este ticket" });
  }

  if (req.method === "GET") {
    try {
      const messages = db.prepare("SELECT * FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC").all(id);

      // Customer info for admin view
      let customerDetails = null;
      if (isAdmin) {
        try {
          customerDetails = db.prepare(`
            SELECT id, email, name, company_name, plan_tier, slots_limit, subscription_status 
            FROM users WHERE id = ? OR email = ?
          `).get(ticket.user_id, ticket.user_email);
        } catch {}
      }

      return res.status(200).json({ ticket, messages, customerDetails });
    } catch (err: any) {
      console.error("[Support Ticket ID] GET error:", err);
      return res.status(500).json({ error: "Error al cargar mensajes del ticket" });
    }
  }

  if (req.method === "POST") {
    // Add reply message
    try {
      const { message } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "El mensaje no puede estar vacío" });
      }

      const messageId = randomUUID();
      const senderRole = isAdmin ? "admin" : "user";
      const senderName = isAdmin 
        ? "Equipo de Soporte InHubFlow" 
        : (dbUser?.name || sessionUser.name || userEmail.split("@")[0]);

      // Determine new status
      let newStatus = ticket.status;
      if (isAdmin) {
        if (ticket.status === "open") newStatus = "waiting_client";
      } else {
        if (ticket.status === "waiting_client" || ticket.status === "resolved") newStatus = "in_progress";
      }

      const replyTx = db.transaction(() => {
        db.prepare(`
          INSERT INTO support_ticket_messages (
            id, ticket_id, sender_id, sender_email, sender_role, sender_name, message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          messageId,
          id,
          userId,
          userEmail,
          senderRole,
          senderName,
          message.trim()
        );

        db.prepare(`
          UPDATE support_tickets 
          SET status = ?, updated_at = datetime('now'), last_reply_at = datetime('now')
          WHERE id = ?
        `).run(newStatus, id);
      });

      replyTx();

      // Email notification if admin replied to customer
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey && isAdmin && ticket.user_email) {
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
              to: [ticket.user_email],
              subject: `[Respuesta Ticket #TCK-${ticket.ticket_number}] ${ticket.subject}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
                  <h2 style="color: #4f46e5; margin-top: 0;">Respuesta a tu Ticket de Soporte (#TCK-${ticket.ticket_number})</h2>
                  <p>Hola <strong>${ticket.user_name || 'Cliente'}</strong>,</p>
                  <p>El equipo de soporte de InHubFlow ha respondido a tu consulta sobre: <em>"${ticket.subject}"</em></p>
                  <div style="background: #f8fafc; padding: 16px; border-left: 4px solid #4f46e5; border-radius: 4px; margin: 16px 0; font-size: 14px; white-space: pre-wrap;">
${message.trim()}
                  </div>
                  <p style="font-size: 13px; color: #6b7280;">Puedes responder a este mensaje directamente ingresando a tu Centro de Soporte en la plataforma:</p>
                  <div style="margin-top: 20px;">
                    <a href="https://b2b.inhubflow.online/support" style="background: #4f46e5; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 13px;">
                      Ir a mi Ticket en InHubFlow
                    </a>
                  </div>
                </div>
              `,
            }),
          });
        } catch (e) {
          console.warn("[Support Ticket ID] Error sending customer reply email:", e);
        }
      }

      return res.status(201).json({
        success: true,
        message: {
          id: messageId,
          ticket_id: id,
          sender_id: userId,
          sender_email: userEmail,
          sender_role: senderRole,
          sender_name: senderName,
          message: message.trim(),
          created_at: new Date().toISOString(),
        },
        newStatus,
      });
    } catch (err: any) {
      console.error("[Support Ticket ID] POST reply error:", err);
      return res.status(500).json({ error: "Error al enviar la respuesta" });
    }
  }

  if (req.method === "PATCH") {
    // Only admin can change status or priority
    if (!isAdmin) {
      return res.status(403).json({ error: "Solo los administradores pueden cambiar el estado del ticket" });
    }

    try {
      const { status, priority } = req.body;
      const updates: string[] = [];
      const params: any[] = [];

      if (status && ["open", "in_progress", "waiting_client", "resolved", "closed"].includes(status)) {
        updates.push("status = ?");
        params.push(status);
      }

      if (priority && ["low", "normal", "high", "urgent"].includes(priority)) {
        updates.push("priority = ?");
        params.push(priority);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "No se proporcionaron cambios válidos" });
      }

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE support_tickets SET ${updates.join(", ")} WHERE id = ?`).run(...params);

      return res.status(200).json({ success: true, status, priority });
    } catch (err: any) {
      console.error("[Support Ticket ID] PATCH error:", err);
      return res.status(500).json({ error: "Error al actualizar ticket" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH"]);
  return res.status(405).json({ error: "Método no permitido" });
}
