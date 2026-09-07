import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import {
  getCalendarSettings,
  saveCalendarSettings,
} from "@/lib/calendar/calendar-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();

  if (req.method === "GET") {
    try {
      const settings = getCalendarSettings(db);
      return res.json({ settings });
    } catch (err: unknown) {
      console.error("[calendar/settings] GET error:", err);
      return res.status(500).json({ error: "Failed to fetch calendar settings" });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    try {
      const settings = saveCalendarSettings(db, req.body ?? {});
      return res.json({ settings });
    } catch (err: unknown) {
      console.error("[calendar/settings] POST/PUT error:", err);
      return res.status(500).json({ error: "Failed to save calendar settings" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PUT"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
