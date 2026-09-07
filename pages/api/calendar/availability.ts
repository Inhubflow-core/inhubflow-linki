import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getCalendarSettings } from "@/lib/calendar/calendar-service";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { date } = req.query;
  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Parámetro date en formato YYYY-MM-DD requerido" });
  }

  const db = getDb();
  const settings = getCalendarSettings(db);

  try {
    // Determine day of week
    const [y, m, d] = date.split("-").map(Number);
    const targetDate = new Date(y, m - 1, d);
    const dayKey = DAY_KEYS[targetDate.getDay()];

    let workingHoursMap: Record<string, Array<{ start: string; end: string }>> = {};
    try {
      workingHoursMap = JSON.parse(settings.working_hours_json);
    } catch {
      workingHoursMap = {
        mon: [{ start: "09:00", end: "18:00" }],
        tue: [{ start: "09:00", end: "18:00" }],
        wed: [{ start: "09:00", end: "18:00" }],
        thu: [{ start: "09:00", end: "18:00" }],
        fri: [{ start: "09:00", end: "18:00" }],
      };
    }

    const intervals = workingHoursMap[dayKey] || [];
    if (intervals.length === 0) {
      return res.json({
        date,
        dayOfWeek: dayKey,
        slots: [],
        slot_duration_minutes: settings.slot_duration_minutes,
        timezone: settings.timezone,
      });
    }

    // Fetch existing confirmed/completed events for that day
    const bookedEvents = db.prepare(`
      SELECT start_time, end_time FROM calendar_events
      WHERE status IN ('confirmed', 'completed')
        AND (start_time LIKE ? OR end_time LIKE ?)
    `).all(`${date}%`, `${date}%`) as Array<{ start_time: string; end_time: string }>;

    const slotDurationMs = settings.slot_duration_minutes * 60 * 1000;
    const minNoticeMs = (settings.min_notice_hours || 2) * 60 * 60 * 1000;
    const nowMs = Date.now();

    const slots: Array<{
      time: string;
      start_time: string;
      end_time: string;
      available: boolean;
    }> = [];

    for (const interval of intervals) {
      const [startHour, startMin] = interval.start.split(":").map(Number);
      const [endHour, endMin] = interval.end.split(":").map(Number);

      const intervalStart = new Date(y, m - 1, d, startHour, startMin, 0, 0);
      const intervalEnd = new Date(y, m - 1, d, endHour, endMin, 0, 0);

      let currentSlotStart = new Date(intervalStart);

      while (currentSlotStart.getTime() + slotDurationMs <= intervalEnd.getTime()) {
        const currentSlotEnd = new Date(currentSlotStart.getTime() + slotDurationMs);
        const slotStartMs = currentSlotStart.getTime();
        const slotEndMs = currentSlotEnd.getTime();

        const timeLabel = `${String(currentSlotStart.getHours()).padStart(2, "0")}:${String(
          currentSlotStart.getMinutes()
        ).padStart(2, "0")}`;

        // Check if slot has enough notice from right now
        let available = slotStartMs >= nowMs + minNoticeMs;

        // Check overlap with booked events
        if (available) {
          for (const evt of bookedEvents) {
            const evtStartMs = new Date(evt.start_time).getTime();
            const evtEndMs = new Date(evt.end_time).getTime();

            // Overlap condition: slot starts before event ends AND slot ends after event starts
            if (slotStartMs < evtEndMs && slotEndMs > evtStartMs) {
              available = false;
              break;
            }
          }
        }

        slots.push({
          time: timeLabel,
          start_time: currentSlotStart.toISOString(),
          end_time: currentSlotEnd.toISOString(),
          available,
        });

        // Step by slot duration
        currentSlotStart = new Date(currentSlotStart.getTime() + slotDurationMs);
      }
    }

    return res.json({
      date,
      dayOfWeek: dayKey,
      slots,
      slot_duration_minutes: settings.slot_duration_minutes,
      timezone: settings.timezone,
    });
  } catch (err: unknown) {
    console.error("[calendar/availability] error:", err);
    return res.status(500).json({ error: "Error al calcular disponibilidad" });
  }
}
