import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type AuditActorType = "system" | "worker" | "user" | "provider";

export interface SdrAuditInput {
  workspaceOwnerId?: string | null;
  actorType: AuditActorType;
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  threadId?: string | null;
  actionId?: string | null;
  handoffId?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
}

function safeJson(value: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    throw new Error("Audit payload must be JSON serializable");
  }
}

export function recordSdrAuditEvent(
  db: Database.Database,
  input: SdrAuditInput,
): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO sdr_audit_events (
      id, workspace_owner_id, actor_type, actor_user_id,
      entity_type, entity_id, event_type, thread_id, action_id,
      handoff_id, correlation_id, idempotency_key, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(
    id,
    input.workspaceOwnerId ?? null,
    input.actorType,
    input.actorUserId ?? null,
    input.entityType,
    input.entityId,
    input.eventType,
    input.threadId ?? null,
    input.actionId ?? null,
    input.handoffId ?? null,
    input.correlationId ?? null,
    input.idempotencyKey ?? null,
    safeJson(input.payload),
  );

  if (!input.idempotencyKey) return id;
  const row = db.prepare(
    "SELECT id FROM sdr_audit_events WHERE idempotency_key = ?",
  ).get(input.idempotencyKey) as { id: string } | undefined;
  if (!row) throw new Error("Audit event could not be loaded after insert");
  return row.id;
}
