import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import {
  getCalendarEventById,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/calendar/calendar-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "ID de evento requerido" });
  }

  const db = getDb();

  if (req.method === "GET") {
    const event = getCalendarEventById(db, id);
    if (!event) {
      return res.status(404).json({ error: "Evento no encontrado" });
    }
    return res.json({ event });
  }

  if (req.method === "PUT") {
    try {
      const updated = updateCalendarEvent(db, id, req.body ?? {});
      if (!updated) {
        return res.status(404).json({ error: "Evento no encontrado" });
      }
      return res.json({ event: updated });
    } catch (err: unknown) {
      console.error("[calendar/events/[id]] PUT error:", err);
      return res.status(500).json({ error: "Failed to update calendar event" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const success = deleteCalendarEvent(db, id);
      if (!success) {
        return res.status(404).json({ error: "Evento no encontrado" });
      }
      return res.json({ ok: true });
    } catch (err: unknown) {
      console.error("[calendar/events/[id]] DELETE error:", err);
      return res.status(500).json({ error: "Failed to delete calendar event" });
    }
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
