import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface AppNotificationRecord {
  id: string;
  workspace_owner_id: string;
  user_id: string;
  notification_type: string;
  priority: "normal" | "urgent" | "critical";
  title: string;
  body: string;
  href: string;
  entity_type: string;
  entity_id: string;
  thread_id: string | null;
  handoff_id: string | null;
  message_id: string | null;
  data_json: string;
  state: "unread" | "read" | "archived" | "cancelled";
  idempotency_key: string;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAppNotificationInput {
  workspaceOwnerId: string;
  userId: string;
  notificationType: string;
  priority?: AppNotificationRecord["priority"];
  title: string;
  body: string;
  href: string;
  entityType: string;
  entityId: string;
  threadId?: string | null;
  handoffId?: string | null;
  messageId?: string | null;
  data?: Record<string, unknown>;
  idempotencyKey: string;
  queueWebPush?: boolean;
}

function serializeData(value: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    throw new Error("Notification data must be JSON serializable");
  }
}

export function createAppNotification(
  db: Database.Database,
  input: CreateAppNotificationInput,
): AppNotificationRecord {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO app_notifications (
      id, workspace_owner_id, user_id, notification_type, priority,
      title, body, href, entity_type, entity_id, thread_id, handoff_id,
      message_id, data_json, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(
    id,
    input.workspaceOwnerId,
    input.userId,
    input.notificationType,
    input.priority ?? "normal",
    input.title,
    input.body,
    input.href,
    input.entityType,
    input.entityId,
    input.threadId ?? null,
    input.handoffId ?? null,
    input.messageId ?? null,
    serializeData(input.data),
    input.idempotencyKey,
  );

  const notification = db.prepare(
    "SELECT * FROM app_notifications WHERE idempotency_key = ?",
  ).get(input.idempotencyKey) as AppNotificationRecord | undefined;
  if (!notification) throw new Error("Notification could not be loaded after insert");

  db.prepare(`
    INSERT INTO notification_deliveries (
      id, notification_id, channel, state, idempotency_key, sent_at
    ) VALUES (?, ?, 'in_app', 'sent', ?, datetime('now'))
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(randomUUID(), notification.id, `notification:${notification.id}:in_app`);

  if (input.queueWebPush !== false) {
    db.prepare(`
      INSERT INTO notification_deliveries (
        id, notification_id, channel, state, idempotency_key
      ) VALUES (?, ?, 'web_push', 'queued', ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(randomUUID(), notification.id, `notification:${notification.id}:web_push`);
  }

  return notification;
}

export function listUserNotifications(
  db: Database.Database,
  input: {
    userId: string;
    workspaceOwnerId: string;
    state?: "unread" | "read" | "all";
    limit?: number;
    since?: string;
  },
): { notifications: AppNotificationRecord[]; unreadCount: number } {
  const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
  const clauses = ["user_id = ?", "workspace_owner_id = ?", "state != 'cancelled'"];
  const params: Array<string | number> = [input.userId, input.workspaceOwnerId];
  if (input.state && input.state !== "all") {
    clauses.push("state = ?");
    params.push(input.state);
  }
  if (input.since) {
    clauses.push("created_at > ?");
    params.push(input.since);
  }
  params.push(limit);
  const notifications = db.prepare(`
    SELECT * FROM app_notifications
    WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params) as AppNotificationRecord[];
  const unreadCount = (db.prepare(`
    SELECT COUNT(*) AS count FROM app_notifications
    WHERE user_id = ? AND workspace_owner_id = ? AND state = 'unread'
  `).get(input.userId, input.workspaceOwnerId) as { count: number }).count;
  return { notifications, unreadCount };
}

export function markNotificationRead(
  db: Database.Database,
  notificationId: string,
  userId: string,
  workspaceOwnerId: string,
): AppNotificationRecord | null {
  db.prepare(`
    UPDATE app_notifications
    SET state = 'read', read_at = COALESCE(read_at, datetime('now')), updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND workspace_owner_id = ? AND state IN ('unread', 'read')
  `).run(notificationId, userId, workspaceOwnerId);
  return (db.prepare(`
    SELECT * FROM app_notifications
    WHERE id = ? AND user_id = ? AND workspace_owner_id = ?
  `).get(notificationId, userId, workspaceOwnerId) as AppNotificationRecord | undefined) ?? null;
}

export function markAllNotificationsRead(
  db: Database.Database,
  userId: string,
  workspaceOwnerId: string,
): number {
  return db.prepare(`
    UPDATE app_notifications
    SET state = 'read', read_at = COALESCE(read_at, datetime('now')), updated_at = datetime('now')
    WHERE user_id = ? AND workspace_owner_id = ? AND state = 'unread'
  `).run(userId, workspaceOwnerId).changes;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

export function savePushSubscription(
  db: Database.Database,
  input: PushSubscriptionInput & { userId: string; workspaceOwnerId: string },
): string {
  if (!input.endpoint.startsWith("https://")) throw new Error("Push endpoint must use HTTPS");
  if (!input.keys.p256dh || !input.keys.auth) throw new Error("Push subscription keys are required");
  const hash = endpointHash(input.endpoint);
  const existing = db.prepare(
    "SELECT id FROM web_push_subscriptions WHERE endpoint_hash = ?",
  ).get(hash) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  db.prepare(`
    INSERT INTO web_push_subscriptions (
      id, workspace_owner_id, user_id, endpoint, endpoint_hash,
      p256dh, auth, user_agent, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(endpoint) DO UPDATE SET
      workspace_owner_id = excluded.workspace_owner_id,
      user_id = excluded.user_id,
      endpoint_hash = excluded.endpoint_hash,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      active = 1,
      last_error = NULL,
      updated_at = datetime('now')
  `).run(
    id,
    input.workspaceOwnerId,
    input.userId,
    input.endpoint,
    hash,
    input.keys.p256dh,
    input.keys.auth,
    input.userAgent ?? null,
  );
  return id;
}

export function revokePushSubscription(
  db: Database.Database,
  endpoint: string,
  userId: string,
  workspaceOwnerId: string,
): boolean {
  return db.prepare(`
    UPDATE web_push_subscriptions
    SET active = 0, updated_at = datetime('now')
    WHERE endpoint_hash = ? AND user_id = ? AND workspace_owner_id = ?
  `).run(endpointHash(endpoint), userId, workspaceOwnerId).changes === 1;
}
