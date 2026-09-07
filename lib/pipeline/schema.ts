import type Database from "better-sqlite3";

export interface PipelineStage {
  id: string;
  name: string;
  order_index: number;
  color: string;
  trigger_key: string | null;
  is_system: number;
  workspace_owner_id: string | null;
  created_at: string;
}

export const DEFAULT_PIPELINE_STAGES = [
  {
    id: "stage_contacted",
    name: "Contactado",
    order_index: 1,
    color: "#3b82f6",
    trigger_key: "contacted",
    is_system: 1,
  },
  {
    id: "stage_connected",
    name: "Conexión Aceptada",
    order_index: 2,
    color: "#06b6d4",
    trigger_key: "connected",
    is_system: 1,
  },
  {
    id: "stage_replied",
    name: "En Conversación",
    order_index: 3,
    color: "#8b5cf6",
    trigger_key: "replied",
    is_system: 1,
  },
  {
    id: "stage_interested",
    name: "Interesado",
    order_index: 4,
    color: "#f59e0b",
    trigger_key: "sdr_interested",
    is_system: 1,
  },
  {
    id: "stage_meeting",
    name: "Reunión Agendada",
    order_index: 5,
    color: "#10b981",
    trigger_key: "sdr_meeting",
    is_system: 1,
  },
  {
    id: "stage_not_interested",
    name: "No Interesado",
    order_index: 6,
    color: "#ef4444",
    trigger_key: "sdr_not_interested",
    is_system: 1,
  },
  {
    id: "stage_won",
    name: "Cerrado / Ganado",
    order_index: 7,
    color: "#16a34a",
    trigger_key: "manual",
    is_system: 1,
  },
];

function tableColumns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name)
  );
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  if (!hasTable(db, table) || tableColumns(db, table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function applyPipelineSchema(db: Database.Database): void {
  db.transaction(() => {
    // 1. Create pipeline_stages table
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        trigger_key TEXT,
        is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0, 1)),
        workspace_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_stages_order ON pipeline_stages(order_index ASC);
    `);

    // 2. Add stage columns to targets table if targets table exists
    if (hasTable(db, "targets")) {
      ensureColumn(db, "targets", "stage_id", "TEXT REFERENCES pipeline_stages(id) ON DELETE SET NULL");
      ensureColumn(db, "targets", "stage_updated_at", "TEXT");
      db.exec(`CREATE INDEX IF NOT EXISTS idx_targets_stage_id ON targets(stage_id);`);
    }

    // 3. Seed default stages idempotently
    const insertStage = db.prepare(`
      INSERT OR IGNORE INTO pipeline_stages (id, name, order_index, color, trigger_key, is_system)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const stage of DEFAULT_PIPELINE_STAGES) {
      insertStage.run(stage.id, stage.name, stage.order_index, stage.color, stage.trigger_key, stage.is_system);
    }

    // 4. Backfill existing targets without a stage
    if (hasTable(db, "targets")) {
      try {
        // Step 4.1: Meetings
        db.exec(`
          UPDATE targets
          SET stage_id = 'stage_meeting', stage_updated_at = datetime('now')
          WHERE stage_id IS NULL AND reply_kind = 'call_task';
        `);

        // Step 4.2: Not interested
        db.exec(`
          UPDATE targets
          SET stage_id = 'stage_not_interested', stage_updated_at = datetime('now')
          WHERE stage_id IS NULL AND reply_kind = 'not_interested';
        `);

        // Step 4.3: In conversation / replied
        db.exec(`
          UPDATE targets
          SET stage_id = 'stage_replied', stage_updated_at = datetime('now')
          WHERE stage_id IS NULL AND (last_replied_at IS NOT NULL OR email_replied_at IS NOT NULL);
        `);

        // Step 4.4: Connected
        db.exec(`
          UPDATE targets
          SET stage_id = 'stage_connected', stage_updated_at = datetime('now')
          WHERE stage_id IS NULL AND (connected_at IS NOT NULL OR degree = 1);
        `);

        // Step 4.5: Contacted / in sequence
        db.exec(`
          UPDATE targets
          SET stage_id = 'stage_contacted', stage_updated_at = datetime('now')
          WHERE stage_id IS NULL AND (connection_requested_at IS NOT NULL OR message_sent_at IS NOT NULL);
        `);
      } catch {
        // best-effort backfill
      }
    }
  })();
}
