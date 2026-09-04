import type Database from "better-sqlite3";

export const SDR_SCHEMA_VERSION = 2;

function tableColumns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasTable(db, table) || tableColumns(db, table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function coreHasColumn(db: Database.Database, table: string, column: string): boolean {
  return hasTable(db, table) && tableColumns(db, table).has(column);
}

function addSdrColumns(db: Database.Database): void {
  ensureColumn(db, "sdr_agents", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_agents", "runtime_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(runtime_enabled IN (0, 1))");
  ensureColumn(db, "sdr_agents", "provider_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(provider_enabled IN (0, 1))");
  ensureColumn(db, "sdr_agents", "outbound_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(outbound_enabled IN (0, 1))");
  ensureColumn(db, "sdr_agents", "config_revision", "INTEGER NOT NULL DEFAULT 1");

  ensureColumn(db, "sdr_agent_versions", "publication_state", "TEXT NOT NULL DEFAULT 'published'");
  ensureColumn(db, "sdr_agent_versions", "revision_hash", "TEXT");

  ensureColumn(db, "sdr_agent_accounts", "inbound_enabled", "INTEGER NOT NULL DEFAULT 1 CHECK(inbound_enabled IN (0, 1))");
  ensureColumn(db, "sdr_agent_accounts", "outbound_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(outbound_enabled IN (0, 1))");
  ensureColumn(db, "sdr_agent_accounts", "canary_percentage", "INTEGER NOT NULL DEFAULT 0 CHECK(canary_percentage >= 0 AND canary_percentage <= 100)");

  ensureColumn(db, "sdr_knowledge_sources", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_knowledge_sources", "revision", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "sdr_knowledge_sources", "content", "TEXT");

  ensureColumn(db, "sdr_threads", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_threads", "automation_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK(automation_enabled IN (0, 1))");
  ensureColumn(db, "sdr_threads", "control_epoch", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sdr_threads", "human_released_at", "TEXT");
  ensureColumn(db, "sdr_threads", "human_released_by_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_threads", "latest_processed_message_id", "TEXT REFERENCES sdr_messages(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_threads", "lock_reason", "TEXT");

  ensureColumn(db, "sdr_jobs", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_jobs", "control_epoch", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sdr_jobs", "dead_letter_at", "TEXT");
  ensureColumn(db, "sdr_jobs", "heartbeat_at", "TEXT");

  ensureColumn(db, "sdr_decisions", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_decisions", "provider", "TEXT");
  ensureColumn(db, "sdr_decisions", "knowledge_status", "TEXT");
  ensureColumn(db, "sdr_decisions", "knowledge_revision", "TEXT");
  ensureColumn(db, "sdr_decisions", "missing_information_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "sdr_decisions", "policy_outcome", "TEXT");
  ensureColumn(db, "sdr_decisions", "policy_reasons_json", "TEXT NOT NULL DEFAULT '[]'");

  ensureColumn(db, "sdr_actions", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_actions", "message_id", "TEXT REFERENCES sdr_messages(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_actions", "control_epoch", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sdr_actions", "optimistic_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "sdr_actions", "edited_payload_json", "TEXT");
  ensureColumn(db, "sdr_actions", "rejected_by_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_actions", "rejected_at", "TEXT");
  ensureColumn(db, "sdr_actions", "rejection_reason", "TEXT");
  ensureColumn(db, "sdr_actions", "delivery_status", "TEXT");

  ensureColumn(db, "sdr_handoffs", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_handoffs", "message_id", "TEXT REFERENCES sdr_messages(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_handoffs", "idempotency_key", "TEXT");
  ensureColumn(db, "sdr_handoffs", "priority", "TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, "sdr_handoffs", "assignment_source", "TEXT");
  ensureColumn(db, "sdr_handoffs", "control_epoch", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sdr_handoffs", "released_at", "TEXT");
  ensureColumn(db, "sdr_handoffs", "released_by_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");

  ensureColumn(db, "sdr_notifications", "workspace_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  ensureColumn(db, "sdr_notifications", "app_notification_id", "TEXT");

  ensureColumn(db, "accounts", "sdr_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "accounts", "sdr_outbound_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "accounts", "sdr_canary_percentage", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "email_accounts", "sdr_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "email_accounts", "sdr_outbound_enabled", "INTEGER NOT NULL DEFAULT 0");

  ensureColumn(db, "email_replies", "email_account_id", "TEXT REFERENCES email_accounts(id) ON DELETE SET NULL");
  ensureColumn(db, "email_replies", "external_message_id", "TEXT");
  ensureColumn(db, "email_replies", "external_thread_id", "TEXT");
  ensureColumn(db, "email_replies", "in_reply_to", "TEXT");
  ensureColumn(db, "email_replies", "references_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "email_replies", "headers_json", "TEXT NOT NULL DEFAULT '{}'");
}

function createSdrV2Tables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sdr_knowledge_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sdr_knowledge_sources(id) ON DELETE CASCADE,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      revision INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_id, revision, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_sdr_knowledge_chunks_source
      ON sdr_knowledge_chunks(source_id, revision, ordinal);

    CREATE TABLE IF NOT EXISTS sdr_audit_events (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('system', 'worker', 'user', 'provider')),
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      thread_id TEXT REFERENCES sdr_threads(id) ON DELETE SET NULL,
      action_id TEXT REFERENCES sdr_actions(id) ON DELETE SET NULL,
      handoff_id TEXT REFERENCES sdr_handoffs(id) ON DELETE SET NULL,
      correlation_id TEXT,
      idempotency_key TEXT UNIQUE,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sdr_audit_workspace_time
      ON sdr_audit_events(workspace_owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sdr_audit_entity
      ON sdr_audit_events(entity_type, entity_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS sdr_runtime_state (
      scope_key TEXT PRIMARY KEY,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES sdr_agents(id) ON DELETE CASCADE,
      worker_id TEXT,
      worker_started_at TEXT,
      last_heartbeat_at TEXT,
      last_tick_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      queue_depth INTEGER NOT NULL DEFAULT 0,
      oldest_job_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sdr_circuit_breakers (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES sdr_agents(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'closed' CHECK(state IN ('closed', 'open', 'half_open')),
      failure_count INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      retry_after TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_owner_id, agent_id, capability)
    );

    CREATE TABLE IF NOT EXISTS sdr_usage_ledger (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES sdr_agents(id) ON DELETE SET NULL,
      decision_id TEXT REFERENCES sdr_decisions(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      status TEXT NOT NULL,
      error_code TEXT,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sdr_usage_workspace_time
      ON sdr_usage_ledger(workspace_owner_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS sdr_quota_reservations (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES sdr_agents(id) ON DELETE SET NULL,
      account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      email_account_id TEXT REFERENCES email_accounts(id) ON DELETE CASCADE,
      action_id TEXT REFERENCES sdr_actions(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK(channel IN ('linkedin', 'email', 'provider')),
      units INTEGER NOT NULL DEFAULT 1 CHECK(units > 0),
      reservation_date TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved', 'consumed', 'released')),
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sdr_outbox (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      action_id TEXT REFERENCES sdr_actions(id) ON DELETE SET NULL,
      thread_id TEXT NOT NULL REFERENCES sdr_threads(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES sdr_messages(id) ON DELETE SET NULL,
      channel TEXT NOT NULL CHECK(channel IN ('linkedin', 'email')),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'reserved', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
      control_epoch INTEGER NOT NULL,
      recipient_snapshot TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      provider_message_id TEXT,
      provider_thread_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      reconciliation_required INTEGER NOT NULL DEFAULT 0 CHECK(reconciliation_required IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sdr_outbox_state
      ON sdr_outbox(state, created_at);

    CREATE TABLE IF NOT EXISTS sdr_promotion_gates (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES sdr_agents(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      gate_key TEXT NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0 CHECK(passed IN (0, 1)),
      evidence_json TEXT NOT NULL DEFAULT '{}',
      verified_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(agent_id, capability, gate_key)
    );

    CREATE TABLE IF NOT EXISTS app_notifications (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal', 'urgent', 'critical')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      href TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      thread_id TEXT REFERENCES sdr_threads(id) ON DELETE CASCADE,
      handoff_id TEXT REFERENCES sdr_handoffs(id) ON DELETE SET NULL,
      message_id TEXT REFERENCES sdr_messages(id) ON DELETE SET NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread', 'read', 'archived', 'cancelled')),
      idempotency_key TEXT NOT NULL UNIQUE,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_app_notifications_user_state
      ON app_notifications(user_id, state, created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL REFERENCES app_notifications(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK(channel IN ('in_app', 'web_push', 'email')),
      endpoint_hash TEXT,
      state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
      ON notification_deliveries(state, next_attempt_at, created_at);

    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      endpoint_hash TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      last_success_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_web_push_user_active
      ON web_push_subscriptions(user_id, active);

    CREATE TABLE IF NOT EXISTS durable_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function addIndexes(db: Database.Database): void {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_decisions_job_unique
      ON sdr_decisions(job_id)
      WHERE job_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sdr_agents_workspace
      ON sdr_agents(workspace_owner_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sdr_threads_workspace_state
      ON sdr_threads(workspace_owner_id, state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sdr_jobs_workspace_due
      ON sdr_jobs(workspace_owner_id, state, next_attempt_at, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_handoffs_idempotency
      ON sdr_handoffs(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
  if (hasTable(db, "email_replies")) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_email_replies_account_message
        ON email_replies(email_account_id, external_message_id)
        WHERE email_account_id IS NOT NULL AND external_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_email_replies_external_thread
        ON email_replies(email_account_id, external_thread_id, received_at);
    `);
  }
}

function backfillWorkspaceOwnership(db: Database.Database): void {
  if (coreHasColumn(db, "users", "owner_id")) {
    db.exec(`
      UPDATE sdr_agents
      SET workspace_owner_id = (
        SELECT COALESCE(users.owner_id, users.id)
        FROM users
        WHERE users.id = sdr_agents.created_by_user_id
      )
      WHERE workspace_owner_id IS NULL AND created_by_user_id IS NOT NULL;
    `);
  }

  if (coreHasColumn(db, "accounts", "owner_id")) {
    db.exec(`
      UPDATE sdr_threads
      SET workspace_owner_id = (
        SELECT accounts.owner_id FROM accounts
        WHERE accounts.id = sdr_threads.linkedin_account_id
      )
      WHERE workspace_owner_id IS NULL AND linkedin_account_id IS NOT NULL;
    `);
  }

  if (coreHasColumn(db, "email_accounts", "owner_id")) {
    db.exec(`
      UPDATE sdr_threads
      SET workspace_owner_id = (
        SELECT email_accounts.owner_id FROM email_accounts
        WHERE email_accounts.id = sdr_threads.email_account_id
      )
      WHERE workspace_owner_id IS NULL AND email_account_id IS NOT NULL;
    `);
  }

  db.exec(`
    UPDATE sdr_knowledge_sources
    SET workspace_owner_id = (
      SELECT workspace_owner_id FROM sdr_agents
      WHERE sdr_agents.id = sdr_knowledge_sources.agent_id
    )
    WHERE workspace_owner_id IS NULL;

    UPDATE sdr_jobs
    SET workspace_owner_id = (
      SELECT workspace_owner_id FROM sdr_threads
      WHERE sdr_threads.id = sdr_jobs.thread_id
    )
    WHERE workspace_owner_id IS NULL;

    UPDATE sdr_decisions
    SET workspace_owner_id = (
      SELECT workspace_owner_id FROM sdr_threads
      WHERE sdr_threads.id = sdr_decisions.thread_id
    )
    WHERE workspace_owner_id IS NULL;

    UPDATE sdr_actions
    SET workspace_owner_id = (
      SELECT workspace_owner_id FROM sdr_threads
      WHERE sdr_threads.id = sdr_actions.thread_id
    )
    WHERE workspace_owner_id IS NULL;

    UPDATE sdr_handoffs
    SET workspace_owner_id = (
      SELECT workspace_owner_id FROM sdr_threads
      WHERE sdr_threads.id = sdr_handoffs.thread_id
    )
    WHERE workspace_owner_id IS NULL;
  `);
}

/** Applies additive SDR runtime, safety, notification, and ownership upgrades. */
export function applySdrSchemaV2(db: Database.Database): void {
  addSdrColumns(db);
  createSdrV2Tables(db);
  addIndexes(db);
  backfillWorkspaceOwnership(db);
}
