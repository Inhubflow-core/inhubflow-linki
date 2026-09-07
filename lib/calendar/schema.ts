import type Database from "better-sqlite3";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_time: string; // ISO8601 UTC
  end_time: string;   // ISO8601 UTC
  target_id: string | null;
  meeting_link: string | null;
  location: string | null;
  status: "confirmed" | "completed" | "cancelled" | "no_show";
  channel: "linkedin" | "email" | "manual" | "sdr_ai";
  created_by: string | null;
  workspace_owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarSettings {
  id: string;
  slot_duration_minutes: number;
  buffer_time_minutes: number;
  working_hours_json: string;
  timezone: string;
  min_notice_hours: number;
  updated_at: string;
}

export const DEFAULT_WORKING_HOURS = JSON.stringify({
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
  sat: [],
  sun: [],
});

export function applyCalendarSchema(db: Database.Database): void {
  db.transaction(() => {
    // 1. Create calendar_events table
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        meeting_link TEXT,
        location TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'completed', 'cancelled', 'no_show')),
        channel TEXT NOT NULL DEFAULT 'manual' CHECK(channel IN ('linkedin', 'email', 'manual', 'sdr_ai')),
        created_by TEXT,
        workspace_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time ASC);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_target ON calendar_events(target_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status);
    `);

    // 2. Create calendar_settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
        buffer_time_minutes INTEGER NOT NULL DEFAULT 15,
        working_hours_json TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'America/Santiago',
        min_notice_hours INTEGER NOT NULL DEFAULT 4,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 3. Seed default settings idempotently
    const insertSettings = db.prepare(`
      INSERT OR IGNORE INTO calendar_settings (id, slot_duration_minutes, buffer_time_minutes, working_hours_json, timezone, min_notice_hours)
      VALUES ('default', 30, 15, ?, 'America/Santiago', 4)
    `);
    insertSettings.run(DEFAULT_WORKING_HOURS);
  })();
}
