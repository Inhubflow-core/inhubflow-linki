import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import {
  getCalendarEvents,
  createCalendarEvent,
  type CreateCalendarEventInput,
} from "@/lib/calendar/calendar-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();

  if (req.method === "GET") {
    try {
      const { start, end, status, target_id } = req.query;

      const events = getCalendarEvents(db, {
        startDate: typeof start === "string" ? start : undefined,
        endDate: typeof end === "string" ? end : undefined,
        status: typeof status === "string" ? status : undefined,
        targetId: typeof target_id === "string" ? target_id : undefined,
      });

      return res.json({ events });
    } catch (err: unknown) {
      console.error("[calendar/events] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  }

  if (req.method === "POST") {
    try {
      const {
        title,
        description,
        start_time,
        end_time,
        target_id,
        meeting_link,
        location,
        status,
        channel,
        auto_advance_pipeline,
      } = req.body ?? {};

      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "Título de la reunión requerido" });
      }

      if (!start_time || typeof start_time !== "string") {
        return res.status(400).json({ error: "Hora de inicio requerida" });
      }

      if (!end_time || typeof end_time !== "string") {
        return res.status(400).json({ error: "Hora de fin requerida" });
      }

      const input: CreateCalendarEventInput = {
        title: title.trim(),
        description: typeof description === "string" ? description.trim() : null,
        start_time,
        end_time,
        target_id: typeof target_id === "string" && target_id ? target_id : null,
        meeting_link: typeof meeting_link === "string" ? meeting_link.trim() : null,
        location: typeof location === "string" ? location.trim() : null,
        status: status || "confirmed",
        channel: channel || "manual",
        created_by: actor.id,
        workspace_owner_id: actor.workspaceOwnerId,
        auto_advance_pipeline: auto_advance_pipeline !== false,
      };

      const event = createCalendarEvent(db, input);
      return res.status(201).json({ event });
    } catch (err: unknown) {
      console.error("[calendar/events] POST error:", err);
      return res.status(500).json({ error: "Failed to create calendar event" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
