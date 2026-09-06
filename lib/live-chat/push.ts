import Database from "better-sqlite3";
import webpush from "web-push";
import { randomUUID } from "crypto";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function getOrInitVapidKeys(db: Database.Database): VapidKeys {
  // 1. Check environment variables first if provided
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate };
  }

  // 2. Check app_settings table in SQLite
  try {
    const pubRow = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_public_key'").get() as { value: string } | undefined;
    const privRow = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_private_key'").get() as { value: string } | undefined;

    if (pubRow?.value && privRow?.value) {
      return { publicKey: pubRow.value.trim(), privateKey: privRow.value.trim() };
    }
  } catch {
    // If table doesn't exist yet, proceed to generate
  }

  // 3. Auto-generate fresh permanent VAPID keys
  const keys = webpush.generateVAPIDKeys();
  try {
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('vapid_public_key', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(keys.publicKey);

    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('vapid_private_key', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(keys.privateKey);
  } catch (err) {
    console.warn("[Live Chat Push] Could not save VAPID keys to app_settings:", err);
  }

  return keys;
}

export function getVapidPublicKey(db: Database.Database): string {
  const keys = getOrInitVapidKeys(db);
  return keys.publicKey;
}

export async function sendLiveChatPushNotification(
  db: Database.Database,
  payload: {
    title: string;
    body: string;
    sessionId?: string;
  }
) {
  try {
    const keys = getOrInitVapidKeys(db);
    const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:inhubflow@gmail.com";

    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

    const subscriptions = db.prepare(`
      SELECT id, endpoint, p256dh, auth 
      FROM live_chat_push_subscriptions 
      WHERE active = 1
    `).all() as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, total: 0 };
    }

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      href: payload.sessionId ? `/live-chat?session=${payload.sessionId}` : "/live-chat",
      notificationId: "live-chat-" + (payload.sessionId || "alert") + "-" + Date.now(),
    });

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          notificationPayload,
          {
            TTL: 86400, // 24 hours
            urgency: "high",
          }
        );

        db.prepare(`
          UPDATE live_chat_push_subscriptions 
          SET last_success_at = datetime('now'), updated_at = datetime('now') 
          WHERE id = ?
        `).run(sub.id);
        sent++;
      } catch (err: any) {
        failed++;
        console.warn(`[Live Chat Push] Failed to deliver to ${sub.id.slice(0, 8)}:`, err?.statusCode || err?.message);

        // 404 or 410 means subscription expired or was revoked by browser
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          db.prepare(`
            UPDATE live_chat_push_subscriptions 
            SET active = 0, last_error = 'Subscription expired (410/404)', updated_at = datetime('now') 
            WHERE id = ?
          `).run(sub.id);
        } else {
          db.prepare(`
            UPDATE live_chat_push_subscriptions 
            SET last_error = ?, updated_at = datetime('now') 
            WHERE id = ?
          `).run(String(err?.message || "Delivery error").slice(0, 255), sub.id);
        }
      }
    }

    return { sent, failed, total: subscriptions.length };
  } catch (globalErr) {
    console.error("[Live Chat Push] Global dispatch error:", globalErr);
    return { sent: 0, failed: 0, total: 0 };
  }
}
