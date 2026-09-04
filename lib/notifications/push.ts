import type Database from "better-sqlite3";

export interface PushDeliveryResult {
  sent: number;
  failed: number;
  skipped: boolean;
}

interface WebPushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function pushEnabled(): boolean {
  return process.env.WEB_PUSH_ENABLED?.trim().toLowerCase() === "true";
}

function vapidConfigured(): boolean {
  return Boolean(
    process.env.VAPID_SUBJECT?.trim() &&
    process.env.VAPID_PUBLIC_KEY?.trim() &&
    process.env.VAPID_PRIVATE_KEY?.trim(),
  );
}

export function pushPublicKey(): string | null {
  return pushEnabled() && vapidConfigured() ? process.env.VAPID_PUBLIC_KEY!.trim() : null;
}

export async function deliverQueuedWebPush(
  db: Database.Database,
  options: { limit?: number } = {},
): Promise<PushDeliveryResult> {
  if (!pushEnabled() || !vapidConfigured()) return { sent: 0, failed: 0, skipped: true };
  const rows = db.prepare(`
    SELECT d.id, d.notification_id, n.user_id, n.title, n.body, n.href,
      n.priority, n.data_json
    FROM notification_deliveries d
    JOIN app_notifications n ON n.id = d.notification_id
    WHERE d.channel = 'web_push' AND d.state = 'queued'
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= datetime('now'))
    ORDER BY d.created_at ASC LIMIT ?
  `).all(Math.max(1, Math.min(options.limit ?? 20, 100))) as Array<{
    id: string;
    notification_id: string;
    user_id: string;
    title: string;
    body: string;
    href: string;
    priority: string;
    data_json: string;
  }>;
  if (rows.length === 0) return { sent: 0, failed: 0, skipped: false };

  let webpush: typeof import("web-push");
  try {
    const imported = await import("web-push");
    webpush = imported.default ?? imported;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!.trim(),
      process.env.VAPID_PUBLIC_KEY!.trim(),
      process.env.VAPID_PRIVATE_KEY!.trim(),
    );
  } catch (error) {
    for (const row of rows) {
      db.prepare(`UPDATE notification_deliveries SET state = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(error instanceof Error ? error.message.slice(0, 500) : "web-push unavailable", row.id);
    }
    return { sent: 0, failed: rows.length, skipped: false };
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const claimed = db.prepare(`
      UPDATE notification_deliveries
      SET state = 'sending', attempts = attempts + 1, updated_at = datetime('now')
      WHERE id = ? AND state = 'queued'
    `).run(row.id);
    if (claimed.changes !== 1) continue;
    const subscriptions = db.prepare(`
      SELECT id, endpoint, p256dh, auth FROM web_push_subscriptions
      WHERE user_id = ? AND active = 1
    `).all(row.user_id) as WebPushSubscriptionRow[];
    if (subscriptions.length === 0) {
      db.prepare(`UPDATE notification_deliveries SET state = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(row.id);
      sent++;
      continue;
    }

    const payload = JSON.stringify({
      notificationId: row.notification_id,
      title: row.title,
      body: row.body,
      href: row.href,
      priority: row.priority,
    });
    let rowFailed = false;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
        db.prepare(`UPDATE web_push_subscriptions SET last_success_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(subscription.id);
      } catch (error) {
        rowFailed = true;
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          db.prepare("UPDATE web_push_subscriptions SET active = 0, updated_at = datetime('now') WHERE id = ?").run(subscription.id);
        } else {
          db.prepare("UPDATE web_push_subscriptions SET last_error = ?, updated_at = datetime('now') WHERE id = ?")
            .run(error instanceof Error ? error.message.slice(0, 500) : "push delivery failed", subscription.id);
        }
      }
    }
    const hasActiveSubscriptions = subscriptions.some((subscription) => {
      const active = db.prepare(
        "SELECT active FROM web_push_subscriptions WHERE id = ?",
      ).get(subscription.id) as { active: number } | undefined;
      return active?.active === 1;
    });
    if (rowFailed && hasActiveSubscriptions) {
      db.prepare(`UPDATE notification_deliveries SET state = 'failed', last_error = 'One or more push deliveries failed', updated_at = datetime('now') WHERE id = ?`).run(row.id);
      failed++;
    } else {
      db.prepare(`UPDATE notification_deliveries SET state = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(row.id);
      sent++;
    }
  }
  return { sent, failed, skipped: false };
}
