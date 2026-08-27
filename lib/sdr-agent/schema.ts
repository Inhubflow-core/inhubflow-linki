import type Database from "better-sqlite3";

/**
 * Additive, module-owned schema. Linki core calls only applySdrSchema; all SDR
 * behavior remains behind the module bridge. Every statement is idempotent.
 */
export const SDR_SCHEMA_MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sdr_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused', 'archived')),
    mode TEXT NOT NULL DEFAULT 'off' CHECK(mode IN ('off', 'shadow', 'approval', 'auto')),
    default_language TEXT NOT NULL DEFAULT 'en' CHECK(default_language IN ('en', 'es', 'pt-BR')),
    model TEXT,
    active_version_id TEXT REFERENCES sdr_agent_versions(id) ON DELETE SET NULL,
    handoff_email TEXT,
    confidence_threshold REAL NOT NULL DEFAULT 0.85 CHECK(confidence_threshold >= 0 AND confidence_threshold <= 1),
    max_auto_turns INTEGER NOT NULL DEFAULT 3 CHECK(max_auto_turns >= 0),
    daily_budget_usd REAL CHECK(daily_budget_usd IS NULL OR daily_budget_usd >= 0),
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sdr_agent_versions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES sdr_agents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK(version_number > 0),
    model TEXT,
    system_prompt TEXT NOT NULL,
    policy_json TEXT NOT NULL DEFAULT '{}',
    config_json TEXT NOT NULL DEFAULT '{}',
    knowledge_revision TEXT,
    published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    published_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(agent_id, version_number)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_agent_versions_agent
    ON sdr_agent_versions(agent_id, version_number DESC)`,
  `CREATE TABLE IF NOT EXISTS sdr_agent_accounts (
    agent_id TEXT NOT NULL REFERENCES sdr_agents(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(agent_id, account_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_agent_accounts_account
    ON sdr_agent_accounts(account_id, enabled)`,
  `CREATE TABLE IF NOT EXISTS sdr_knowledge_sources (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES sdr_agents(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'retired')),
    title TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('text', 'file', 'url', 'catalog', 'policy')),
    source_uri TEXT,
    provider TEXT,
    provider_store_id TEXT,
    provider_document_id TEXT,
    checksum TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_knowledge_agent_status
    ON sdr_knowledge_sources(agent_id, status)`,
  `CREATE TABLE IF NOT EXISTS sdr_threads (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('linkedin', 'email')),
    linkedin_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    email_account_id TEXT REFERENCES email_accounts(id) ON DELETE SET NULL,
    external_thread_id TEXT NOT NULL,
    agent_id TEXT REFERENCES sdr_agents(id) ON DELETE SET NULL,
    agent_version_id TEXT REFERENCES sdr_agent_versions(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'AI_ACTIVE' CHECK(state IN ('AI_ACTIVE', 'HUMAN_REVIEW', 'HUMAN_ACTIVE', 'WAITING_LEAD', 'RESOLVED', 'DO_NOT_CONTACT')),
    language TEXT,
    summary TEXT,
    ai_turn_count INTEGER NOT NULL DEFAULT 0 CHECK(ai_turn_count >= 0),
    human_takeover_at TEXT,
    human_takeover_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_inbound_at TEXT,
    last_outbound_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK(
      (channel = 'linkedin' AND linkedin_account_id IS NOT NULL)
      OR (channel = 'email' AND email_account_id IS NOT NULL)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_threads_linkedin_external
    ON sdr_threads(linkedin_account_id, external_thread_id)
    WHERE channel = 'linkedin'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_threads_email_external
    ON sdr_threads(email_account_id, external_thread_id)
    WHERE channel = 'email'`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_threads_target
    ON sdr_threads(target_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_threads_state
    ON sdr_threads(state, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sdr_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES sdr_threads(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound', 'system')),
    external_message_id TEXT,
    sender_external_id TEXT,
    sender_name TEXT,
    body TEXT NOT NULL,
    content_hash TEXT,
    language TEXT,
    sent_at TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    delivery_status TEXT NOT NULL DEFAULT 'captured' CHECK(delivery_status IN ('captured', 'queued', 'sending', 'sent', 'delivered', 'failed')),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_messages_external
    ON sdr_messages(thread_id, external_message_id)
    WHERE external_message_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_messages_thread_time
    ON sdr_messages(thread_id, sent_at, id)`,
  `CREATE TABLE IF NOT EXISTS sdr_jobs (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES sdr_threads(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES sdr_messages(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK(job_type IN ('classify', 'decide', 'execute_tool', 'send_reply', 'handoff', 'calendar')),
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued', 'leased', 'waiting', 'completed', 'failed', 'cancelled')),
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts > 0),
    next_attempt_at TEXT,
    lease_token TEXT,
    lease_expires_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_jobs_due
    ON sdr_jobs(state, next_attempt_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_jobs_thread
    ON sdr_jobs(thread_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sdr_decisions (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES sdr_jobs(id) ON DELETE SET NULL,
    thread_id TEXT NOT NULL REFERENCES sdr_threads(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES sdr_messages(id) ON DELETE SET NULL,
    agent_version_id TEXT REFERENCES sdr_agent_versions(id) ON DELETE SET NULL,
    intent TEXT NOT NULL,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high')),
    language TEXT,
    recommended_action TEXT NOT NULL,
    requires_human INTEGER NOT NULL DEFAULT 0 CHECK(requires_human IN (0, 1)),
    reason_code TEXT,
    reply_draft TEXT,
    citations_json TEXT NOT NULL DEFAULT '[]',
    decision_json TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_decisions_thread
    ON sdr_decisions(thread_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sdr_actions (
    id TEXT PRIMARY KEY,
    decision_id TEXT REFERENCES sdr_decisions(id) ON DELETE SET NULL,
    thread_id TEXT NOT NULL REFERENCES sdr_threads(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed', 'waiting_approval', 'approved', 'executing', 'completed', 'failed', 'cancelled')),
    idempotency_key TEXT NOT NULL UNIQUE,
    requires_approval INTEGER NOT NULL DEFAULT 1 CHECK(requires_approval IN (0, 1)),
    payload_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at TEXT,
    executed_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_actions_thread
    ON sdr_actions(thread_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sdr_handoffs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES sdr_threads(id) ON DELETE CASCADE,
    decision_id TEXT REFERENCES sdr_decisions(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open', 'acknowledged', 'resolved', 'cancelled')),
    reason_code TEXT NOT NULL,
    summary TEXT NOT NULL,
    recommended_reply TEXT,
    assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    assigned_email TEXT,
    due_at TEXT,
    acknowledged_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_handoffs_state
    ON sdr_handoffs(state, due_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS sdr_calendar_integrations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES sdr_agents(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'google' CHECK(provider IN ('google')),
    account_email TEXT,
    calendar_id TEXT,
    encrypted_access_token TEXT,
    encrypted_refresh_token TEXT,
    token_expires_at TEXT,
    scopes TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('disconnected', 'connected', 'error', 'revoked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(agent_id, provider)
  )`,
  `CREATE TABLE IF NOT EXISTS sdr_meeting_bookings (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES sdr_threads(id) ON DELETE CASCADE,
    action_id TEXT REFERENCES sdr_actions(id) ON DELETE SET NULL,
    calendar_integration_id TEXT NOT NULL REFERENCES sdr_calendar_integrations(id) ON DELETE CASCADE,
    external_event_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'confirmed', 'cancelled', 'failed')),
    timezone TEXT NOT NULL,
    starts_at TEXT,
    ends_at TEXT,
    attendee_email TEXT,
    meeting_url TEXT,
    offered_slots_json TEXT NOT NULL DEFAULT '[]',
    selected_slot_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_meetings_thread
    ON sdr_meeting_bookings(thread_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sdr_notifications (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES sdr_threads(id) ON DELETE CASCADE,
    handoff_id TEXT REFERENCES sdr_handoffs(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK(channel IN ('in_app', 'email')),
    recipient TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued', 'sent', 'read', 'failed', 'cancelled')),
    idempotency_key TEXT NOT NULL UNIQUE,
    sent_at TEXT,
    read_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdr_notifications_state
    ON sdr_notifications(state, created_at)`,
];

/**
 * Applies the complete module schema atomically. Unlike legacy best-effort core
 * migrations, a malformed SDR statement fails startup instead of leaving an
 * incomplete set of tables that would fail later during message processing.
 */
export function applySdrSchema(db: Database.Database): void {
  db.transaction(() => {
    for (const statement of SDR_SCHEMA_MIGRATIONS) db.exec(statement);
  })();
}
