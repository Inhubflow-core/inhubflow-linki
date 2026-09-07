import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import {
  createCalendarEvent,
  getCalendarSettings,
} from "@/lib/calendar/calendar-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, start_time, end_time, phone, company, notes } = req.body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Email corporativo válido requerido" });
  }

  if (!start_time || !end_time) {
    return res.status(400).json({ error: "Fecha y hora de inicio/fin requeridas" });
  }

  const db = getDb();
  const settings = getCalendarSettings(db);

  try {
    const slotStart = new Date(start_time).getTime();
    const slotEnd = new Date(end_time).getTime();

    // 1. Check double booking collision
    const collision = db.prepare(`
      SELECT id FROM calendar_events
      WHERE status IN ('confirmed', 'completed')
        AND start_time < ? AND end_time > ?
      LIMIT 1
    `).get(new Date(slotEnd).toISOString(), new Date(slotStart).toISOString());

    if (collision) {
      return res.status(409).json({
        error: "Este horario ya fue reservado por otro usuario. Por favor selecciona otro horario disponible.",
      });
    }

    // 2. Find or create target in CRM
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    let targetId: string | null = null;

    const existingTarget = db.prepare(`
      SELECT id FROM targets WHERE lower(email) = ? LIMIT 1
    `).get(cleanEmail) as { id: string } | undefined;

    if (existingTarget) {
      targetId = existingTarget.id;
      // Optionally update company or phone if provided
      if (company || phone) {
        db.prepare(`
          UPDATE targets
          SET company = coalesce(?, company),
              phone = coalesce(?, phone)
          WHERE id = ?
        `).run(company?.trim() || null, phone?.trim() || null, targetId);
      }
    } else {
      // Create new lead in targets
      targetId = `tgt_${randomUUID()}`;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO targets (
          id, full_name, email, phone, company, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetId,
        cleanName,
        cleanEmail,
        phone?.trim() || null,
        company?.trim() || null,
        now,
        now
      );
    }

    // 3. Generate or assign video meeting link
    // E.g. Google Meet clean room code
    const randomRoom = Math.random().toString(36).substring(2, 5) + "-" +
      Math.random().toString(36).substring(2, 6) + "-" +
      Math.random().toString(36).substring(2, 5);
    const meetingLink = `https://meet.google.com/${randomRoom}`;

    const title = `Reunión Comercial: ${cleanName} ${company ? `(${company.trim()})` : ""}`.trim();

    // 4. Create calendar event with auto-advance in pipeline
    const event = createCalendarEvent(db, {
      title,
      description: notes?.trim() || "Reserva agendada a través de la página pública de reservas.",
      start_time: new Date(slotStart).toISOString(),
      end_time: new Date(slotEnd).toISOString(),
      target_id: targetId,
      meeting_link: meetingLink,
      status: "confirmed",
      channel: "sdr_ai",
      auto_advance_pipeline: true,
    });

    // 5. Safely attempt to send confirmation email if SMTP is configured
    try {
      const emailAcc = db.prepare(`SELECT * FROM email_accounts LIMIT 1`).get() as any;
      if (emailAcc && emailAcc.smtp_host) {
        const { sendEmail } = await import("@/lib/email/sender");
        const formattedDate = new Date(slotStart).toLocaleString("es-ES", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const emailSubject = `Confirmación de Reunión: ${title}`;
        const emailBody = `Hola ${cleanName},\n\nTu reunión ha sido agendada con éxito.\n\nFecha y hora: ${formattedDate} (${settings.timezone})\nEnlace de Google Meet: ${meetingLink}\n\n¡Nos vemos pronto!\nEquipo InHubFlow`;

        sendEmail(emailAcc, cleanEmail, emailSubject, emailBody).catch((e) =>
          console.warn("[calendar/book] Failed to dispatch email confirmation:", e)
        );
      }
    } catch (emailErr) {
      console.warn("[calendar/book] Email confirmation skipped:", emailErr);
    }

    return res.status(201).json({
      ok: true,
      event,
      meeting_link: meetingLink,
      timezone: settings.timezone,
    });
  } catch (err: unknown) {
    console.error("[calendar/book] error:", err);
    return res.status(500).json({ error: "Error al procesar la reserva" });
  }
}
