import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SdrInboundMessageSchema, type SdrInboundMessage } from "./contracts";
import { enqueueSdrJob, type SdrJob } from "./jobs";

export class SdrEventValidationError extends Error {
  readonly validationErrors: string[];

  constructor(validationErrors: string[]) {
    super("Invalid SDR inbound event");
    this.name = "SdrEventValidationError";
    this.validationErrors = validationErrors;
  }
}

export interface SdrThreadRecord {
  id: string;
  target_id: string;
  channel: "linkedin" | "email";
  linkedin_account_id: string | null;
  email_account_id: string | null;
  external_thread_id: string;
  agent_id: string | null;
  agent_version_id: string | null;
  state: string;
  language: string | null;
  summary: string | null;
  ai_turn_count: number;
  human_takeover_at: string | null;
  human_takeover_by_user_id: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
  workspace_owner_id: string | null;
  automation_enabled: number;
  control_epoch: number;
  human_released_at: string | null;
  human_released_by_user_id: string | null;
  latest_processed_message_id: string | null;
  lock_reason: string | null;
}

export interface SdrMessageRecord {
  id: string;
  thread_id: string;
  direction: "inbound" | "outbound" | "system";
  external_message_id: string | null;
  sender_external_id: string | null;
  sender_name: string | null;
  body: string;
  content_hash: string | null;
  language: string | null;
  sent_at: string;
  captured_at: string;
  delivery_status: string;
  metadata_json: string;
  created_at: string;
}

export interface CapturedInboundMessage {
  thread: SdrThreadRecord;
  message: SdrMessageRecord;
  job: SdrJob | null;
  duplicate: boolean;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

function parseEvent(event: unknown): SdrInboundMessage {
  const parsed = SdrInboundMessageSchema.safeParse(event);
  if (!parsed.success) {
    throw new SdrEventValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    );
  }
  return parsed.data;
}

function serializeMetadata(event: SdrInboundMessage): string {
  try {
    return JSON.stringify(event.metadata ?? {});
  } catch {
    throw new SdrEventValidationError(["metadata: must be JSON serializable"]);
  }
}

function contentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

interface CaptureOwnership {
  workspaceOwnerId: string | null;
  agentId: string | null;
  agentVersionId: string | null;
  automationEnabled: number;
}

function resolveCaptureOwnership(
  db: Database.Database,
  event: SdrInboundMessage,
): CaptureOwnership {
  let workspaceOwnerId: string | null = null;
  let accountSdrEnabled: number | null = null;
  if (event.channel === "linkedin" && hasColumn(db, "accounts", "owner_id")) {
    const row = db.prepare(
      "SELECT owner_id, sdr_enabled FROM accounts WHERE id = ?",
    ).get(event.accountId) as { owner_id: string | null; sdr_enabled: number } | undefined;
    workspaceOwnerId = row?.owner_id ?? null;
    accountSdrEnabled = row?.sdr_enabled ?? null;
  } else if (event.channel === "email" && hasColumn(db, "email_accounts", "owner_id")) {
    const row = db.prepare(
      "SELECT owner_id, sdr_enabled FROM email_accounts WHERE id = ?",
    ).get(event.emailAccountId) as { owner_id: string | null; sdr_enabled: number } | undefined;
    workspaceOwnerId = row?.owner_id ?? null;
    accountSdrEnabled = row?.sdr_enabled ?? null;
  }

  let targetAutopilot: number | null = null;
  if (hasColumn(db, "targets", "sdr_autopilot")) {
    const row = db.prepare("SELECT sdr_autopilot FROM targets WHERE id = ?").get(event.targetId) as
      | { sdr_autopilot: number }
      | undefined;
    targetAutopilot = row?.sdr_autopilot ?? null;
  }

  let agentId: string | null = null;
  let agentVersionId: string | null = null;
  if (workspaceOwnerId) {
    const mappedAccountColumn = event.channel === "linkedin" ? "account_id" : null;
    const mapped = mappedAccountColumn
      ? db.prepare(`
          SELECT ag.id, ag.active_version_id
          FROM sdr_agent_accounts saa
          JOIN sdr_agents ag ON ag.id = saa.agent_id
          WHERE saa.account_id = ? AND saa.enabled = 1
            AND ag.workspace_owner_id = ? AND ag.status != 'archived'
          ORDER BY ag.created_at ASC LIMIT 1
        `).get(event.accountId, workspaceOwnerId) as
          | { id: string; active_version_id: string | null }
          | undefined
      : undefined;
    const agent = mapped ?? db.prepare(`
      SELECT id, active_version_id FROM sdr_agents
      WHERE workspace_owner_id = ? AND status != 'archived'
      ORDER BY created_at ASC LIMIT 1
    `).get(workspaceOwnerId) as { id: string; active_version_id: string | null } | undefined;
    agentId = agent?.id ?? null;
    agentVersionId = agent?.active_version_id ?? null;
  }

  return {
    workspaceOwnerId,
    agentId,
    agentVersionId,
    automationEnabled:
      accountSdrEnabled === null && targetAutopilot === null
        ? 1
        : accountSdrEnabled === 1 && targetAutopilot === 1
          ? 1
          : 0,
  };
}

function findThread(db: Database.Database, event: SdrInboundMessage): SdrThreadRecord | null {
  const query = event.channel === "linkedin"
    ? "SELECT * FROM sdr_threads WHERE channel = 'linkedin' AND linkedin_account_id = ? AND external_thread_id = ?"
    : "SELECT * FROM sdr_threads WHERE channel = 'email' AND email_account_id = ? AND external_thread_id = ?";
  const accountId = event.channel === "linkedin" ? event.accountId : event.emailAccountId;
  return (db.prepare(query).get(accountId, event.externalThreadId) as SdrThreadRecord | undefined) ?? null;
}

function findMessage(db: Database.Database, threadId: string, externalMessageId: string): SdrMessageRecord | null {
  return (db.prepare(
    "SELECT * FROM sdr_messages WHERE thread_id = ? AND external_message_id = ?"
  ).get(threadId, externalMessageId) as SdrMessageRecord | undefined) ?? null;
}

/**
 * Captures one inbound event transactionally. Thread identity is scoped to the
 * originating account and external thread id; message identity is scoped to the
 * thread and external message id. Duplicate sync events are harmless.
 */
export function captureSdrInboundMessage(
  db: Database.Database,
  event: unknown,
): CapturedInboundMessage {
  const parsed = parseEvent(event);
  const ownership = resolveCaptureOwnership(db, parsed);
  const metadataJson = serializeMetadata(parsed);
  const capturedAt = nowSql();

  return db.transaction(() => {
    let thread = findThread(db, parsed);
    if (!thread) {
      const threadId = randomUUID();
      const insert = parsed.channel === "linkedin"
        ? db.prepare(`
            INSERT INTO sdr_threads (
              id, workspace_owner_id, target_id, channel, linkedin_account_id,
              external_thread_id, agent_id, agent_version_id, automation_enabled,
              state, last_inbound_at, updated_at
            ) VALUES (?, ?, ?, 'linkedin', ?, ?, ?, ?, ?, 'AI_ACTIVE', ?, ?)
          `)
        : db.prepare(`
            INSERT INTO sdr_threads (
              id, workspace_owner_id, target_id, channel, email_account_id,
              external_thread_id, agent_id, agent_version_id, automation_enabled,
              state, last_inbound_at, updated_at
            ) VALUES (?, ?, ?, 'email', ?, ?, ?, ?, ?, 'AI_ACTIVE', ?, ?)
          `);
      const accountId = parsed.channel === "linkedin" ? parsed.accountId : parsed.emailAccountId;
      try {
        insert.run(
          threadId,
          ownership.workspaceOwnerId,
          parsed.targetId,
          accountId,
          parsed.externalThreadId,
          ownership.agentId,
          ownership.agentVersionId,
          ownership.automationEnabled,
          parsed.receivedAt,
          capturedAt,
        );
      } catch (error) {
        // A concurrent sync may have inserted the same thread between SELECT and
        // INSERT. Re-read it and only surface genuine integrity errors.
        thread = findThread(db, parsed);
        if (!thread) throw error;
      }
      thread ??= findThread(db, parsed);
    }

    if (!thread) throw new Error("SDR thread could not be loaded after capture");
    if (
      ownership.workspaceOwnerId &&
      (!thread.workspace_owner_id || !thread.agent_id || !thread.agent_version_id)
    ) {
      db.prepare(`
        UPDATE sdr_threads
        SET workspace_owner_id = COALESCE(workspace_owner_id, ?),
          agent_id = COALESCE(agent_id, ?),
          agent_version_id = COALESCE(agent_version_id, ?),
          automation_enabled = CASE
            WHEN automation_enabled = 1 THEN 1 ELSE ?
          END,
          updated_at = ?
        WHERE id = ?
      `).run(
        ownership.workspaceOwnerId,
        ownership.agentId,
        ownership.agentVersionId,
        ownership.automationEnabled,
        capturedAt,
        thread.id,
      );
      thread = findThread(db, parsed);
      if (!thread) throw new Error("SDR thread could not be reloaded after ownership update");
    }
    if (thread.target_id !== parsed.targetId) {
      throw new Error("SDR external thread is already linked to a different target");
    }

    const existingMessage = findMessage(db, thread.id, parsed.externalMessageId);
    if (existingMessage) {
      const existingJob = db.prepare(
        "SELECT * FROM sdr_jobs WHERE idempotency_key = ?"
      ).get(`classify:${thread.id}:${parsed.externalMessageId}`) as SdrJob | undefined;
      return { thread, message: existingMessage, job: existingJob ?? null, duplicate: true };
    }

    const messageId = randomUUID();
    db.prepare(`
      INSERT INTO sdr_messages (
        id, thread_id, direction, external_message_id, sender_external_id,
        sender_name, body, content_hash, sent_at, captured_at, metadata_json
      ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      thread.id,
      parsed.externalMessageId,
      parsed.senderExternalId ?? null,
      parsed.senderName ?? null,
      parsed.body,
      contentHash(parsed.body),
      parsed.receivedAt,
      capturedAt,
      metadataJson,
    );

    db.prepare(`
      UPDATE sdr_threads
      SET last_inbound_at = ?, updated_at = ?
      WHERE id = ? AND state NOT IN ('DO_NOT_CONTACT', 'RESOLVED')
    `).run(parsed.receivedAt, capturedAt, thread.id);

    const updatedThread = db.prepare("SELECT * FROM sdr_threads WHERE id = ?").get(thread.id) as SdrThreadRecord;
    const processingBlocked = ["DO_NOT_CONTACT", "RESOLVED", "HUMAN_REVIEW", "HUMAN_ACTIVE"].includes(
      updatedThread.state,
    );
    const job = processingBlocked
      ? null
      : enqueueSdrJob(db, {
          workspaceOwnerId: updatedThread.workspace_owner_id,
          threadId: thread.id,
          messageId,
          controlEpoch: updatedThread.control_epoch,
          jobType: "classify",
          idempotencyKey: `classify:${thread.id}:${parsed.externalMessageId}`,
          payload: { eventId: parsed.eventId, messageId, threadId: thread.id },
        });
    const message = db.prepare("SELECT * FROM sdr_messages WHERE id = ?").get(messageId) as SdrMessageRecord;
    return { thread: updatedThread, message, job, duplicate: false };
  })();
}

export function getSdrThread(db: Database.Database, threadId: string): SdrThreadRecord | null {
  return (db.prepare("SELECT * FROM sdr_threads WHERE id = ?").get(threadId) as SdrThreadRecord | undefined) ?? null;
}

export function listSdrMessages(db: Database.Database, threadId: string): SdrMessageRecord[] {
  return db.prepare(
    "SELECT * FROM sdr_messages WHERE thread_id = ? ORDER BY sent_at ASC, id ASC"
  ).all(threadId) as SdrMessageRecord[];
}
