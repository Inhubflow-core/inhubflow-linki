import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { autoAdvanceTargetByTrigger } from "@/lib/pipeline/pipeline-service";
import type { CalendarEvent, CalendarSettings } from "./schema";

export interface CalendarEventWithTarget extends CalendarEvent {
  target_name?: string | null;
  target_company?: string | null;
  target_title?: string | null;
  target_email?: string | null;
  target_linkedin_url?: string | null;
  target_location?: string | null;
  target_image_url?: string | null;
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string | null;
  start_time: string; // ISO8601 UTC
  end_time: string;   // ISO8601 UTC
  target_id?: string | null;
  meeting_link?: string | null;
  location?: string | null;
  status?: "confirmed" | "completed" | "cancelled" | "no_show";
  channel?: "linkedin" | "email" | "manual" | "sdr_ai";
  created_by?: string | null;
  workspace_owner_id?: string | null;
  auto_advance_pipeline?: boolean;
}

export interface UpdateCalendarEventInput {
  title?: string;
  description?: string | null;
  start_time?: string;
  end_time?: string;
  target_id?: string | null;
  meeting_link?: string | null;
  location?: string | null;
  status?: "confirmed" | "completed" | "cancelled" | "no_show";
  channel?: "linkedin" | "email" | "manual" | "sdr_ai";
}

/**
 * Fetch calendar events within an optional date range or for a specific target.
 */
export function getCalendarEvents(
  db: Database.Database,
  filter?: {
    startDate?: string;
    endDate?: string;
    targetId?: string;
    status?: string;
  }
): CalendarEventWithTarget[] {
  let query = `
    SELECT 
      ce.*,
      t.full_name as target_name,
      t.company as target_company,
      t.title as target_title,
      t.email as target_email,
      t.linkedin_url as target_linkedin_url,
      t.location as target_location,
      t.profile_image_url as target_image_url
    FROM calendar_events ce
    LEFT JOIN targets t ON t.id = ce.target_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filter?.startDate) {
    query += ` AND ce.end_time >= ?`;
    params.push(filter.startDate);
  }

  if (filter?.endDate) {
    query += ` AND ce.start_time <= ?`;
    params.push(filter.endDate);
  }

  if (filter?.targetId) {
    query += ` AND ce.target_id = ?`;
    params.push(filter.targetId);
  }

  if (filter?.status && filter.status !== "all") {
    query += ` AND ce.status = ?`;
    params.push(filter.status);
  }

  query += ` ORDER BY ce.start_time ASC`;

  return db.prepare(query).all(...params) as CalendarEventWithTarget[];
}

/**
 * Fetch a single event by ID with target details.
 */
export function getCalendarEventById(
  db: Database.Database,
  id: string
): CalendarEventWithTarget | null {
  const row = db.prepare(`
    SELECT 
      ce.*,
      t.full_name as target_name,
      t.company as target_company,
      t.title as target_title,
      t.email as target_email,
      t.linkedin_url as target_linkedin_url,
      t.location as target_location,
      t.profile_image_url as target_image_url
    FROM calendar_events ce
    LEFT JOIN targets t ON t.id = ce.target_id
    WHERE ce.id = ?
  `).get(id) as CalendarEventWithTarget | undefined;

  return row || null;
}

/**
 * Create a new calendar event and optionally advance the prospect to "Reunión Agendada" in the Pipeline.
 */
export function createCalendarEvent(
  db: Database.Database,
  input: CreateCalendarEventInput
): CalendarEventWithTarget {
  const id = `evt_${randomUUID()}`;
  const now = new Date().toISOString();
  const status = input.status || "confirmed";
  const channel = input.channel || "manual";

  db.transaction(() => {
    db.prepare(`
      INSERT INTO calendar_events (
        id, title, description, start_time, end_time, target_id,
        meeting_link, location, status, channel, created_by,
        workspace_owner_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title.trim(),
      input.description || null,
      input.start_time,
      input.end_time,
      input.target_id || null,
      input.meeting_link || null,
      input.location || null,
      status,
      channel,
      input.created_by || null,
      input.workspace_owner_id || null,
      now,
      now
    );

    // Auto-advance prospect in Pipeline if enabled (defaults to true if target provided)
    if (input.target_id && input.auto_advance_pipeline !== false) {
      try {
        autoAdvanceTargetByTrigger(db, input.target_id, "sdr_meeting");
      } catch (err) {
        console.error("Failed to advance target in pipeline:", err);
      }
    }
  })();

  return getCalendarEventById(db, id)!;
}

/**
 * Update an existing calendar event.
 */
export function updateCalendarEvent(
  db: Database.Database,
  id: string,
  input: UpdateCalendarEventInput
): CalendarEventWithTarget | null {
  const existing = getCalendarEventById(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const fields: string[] = ["updated_at = ?"];
  const params: any[] = [now];

  if (input.title !== undefined) {
    fields.push("title = ?");
    params.push(input.title.trim());
  }
  if (input.description !== undefined) {
    fields.push("description = ?");
    params.push(input.description);
  }
  if (input.start_time !== undefined) {
    fields.push("start_time = ?");
    params.push(input.start_time);
  }
  if (input.end_time !== undefined) {
    fields.push("end_time = ?");
    params.push(input.end_time);
  }
  if (input.target_id !== undefined) {
    fields.push("target_id = ?");
    params.push(input.target_id);
  }
  if (input.meeting_link !== undefined) {
    fields.push("meeting_link = ?");
    params.push(input.meeting_link);
  }
  if (input.location !== undefined) {
    fields.push("location = ?");
    params.push(input.location);
  }
  if (input.status !== undefined) {
    fields.push("status = ?");
    params.push(input.status);
  }
  if (input.channel !== undefined) {
    fields.push("channel = ?");
    params.push(input.channel);
  }

  params.push(id);
  db.prepare(`UPDATE calendar_events SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  return getCalendarEventById(db, id);
}

/**
 * Delete a calendar event by ID.
 */
export function deleteCalendarEvent(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM calendar_events WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Get calendar availability settings.
 */
export function getCalendarSettings(db: Database.Database): CalendarSettings {
  const row = db.prepare(`SELECT * FROM calendar_settings WHERE id = 'default'`).get() as
    | CalendarSettings
    | undefined;

  if (row) return row;

  // Fallback defaults
  return {
    id: "default",
    slot_duration_minutes: 30,
    buffer_time_minutes: 15,
    working_hours_json: JSON.stringify({
      mon: [{ start: "09:00", end: "18:00" }],
      tue: [{ start: "09:00", end: "18:00" }],
      wed: [{ start: "09:00", end: "18:00" }],
      thu: [{ start: "09:00", end: "18:00" }],
      fri: [{ start: "09:00", end: "18:00" }],
      sat: [],
      sun: [],
    }),
    timezone: "America/Santiago",
    min_notice_hours: 4,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update calendar availability settings.
 */
export function saveCalendarSettings(
  db: Database.Database,
  settings: Partial<CalendarSettings>
): CalendarSettings {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO calendar_settings (
      id, slot_duration_minutes, buffer_time_minutes,
      working_hours_json, timezone, min_notice_hours, updated_at
    ) VALUES ('default', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slot_duration_minutes = coalesce(excluded.slot_duration_minutes, calendar_settings.slot_duration_minutes),
      buffer_time_minutes = coalesce(excluded.buffer_time_minutes, calendar_settings.buffer_time_minutes),
      working_hours_json = coalesce(excluded.working_hours_json, calendar_settings.working_hours_json),
      timezone = coalesce(excluded.timezone, calendar_settings.timezone),
      min_notice_hours = coalesce(excluded.min_notice_hours, calendar_settings.min_notice_hours),
      updated_at = excluded.updated_at
  `).run(
    settings.slot_duration_minutes ?? 30,
    settings.buffer_time_minutes ?? 15,
    settings.working_hours_json ?? "{}",
    settings.timezone ?? "America/Santiago",
    settings.min_notice_hours ?? 4,
    now
  );

  return getCalendarSettings(db);
}
