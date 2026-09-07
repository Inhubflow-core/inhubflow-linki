import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getCalendarEvents } from "@/lib/calendar/calendar-service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).send("Method not allowed");
  }

  const db = getDb();

  try {
    // Fetch active events from 30 days ago to 90 days in the future
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 90);

    const events = getCalendarEvents(db, {
      startDate: pastDate.toISOString(),
      endDate: futureDate.toISOString(),
    });

    const formatIcsDate = (iso: string) => {
      return new Date(iso).toISOString().replace(/-|:|\.\d\d\d/g, "");
    };

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//InHubFlow//Calendar Feed//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:InHubFlow - Reuniones Comerciales",
      "X-WR-TIMEZONE:UTC",
    ];

    for (const evt of events) {
      if (evt.status === "cancelled") continue;

      const dtStart = formatIcsDate(evt.start_time);
      const dtEnd = formatIcsDate(evt.end_time);
      const dtStamp = formatIcsDate(evt.created_at || evt.start_time);

      const targetInfo = evt.target_name
        ? `Prospecto: ${evt.target_name} (${evt.target_company || "Empresa"})\\nEmail: ${evt.target_email || "N/A"}\\n`
        : "";
      const desc = `${targetInfo}${evt.description || "Reunión programada en InHubFlow."}`.replace(/\n/g, "\\n");
      const location = evt.meeting_link || "Google Meet";

      lines.push(
        "BEGIN:VEVENT",
        `UID:${evt.id}@inhubflow.com`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${evt.title}`,
        `DESCRIPTION:${desc}`,
        `LOCATION:${location}`,
        "STATUS:CONFIRMED",
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");

    const icsContent = lines.join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="inhubflow-calendar.ics"');
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    return res.send(icsContent);
  } catch (err: unknown) {
    console.error("[calendar/feed] error:", err);
    return res.status(500).send("Error generando el feed iCal");
  }
}
