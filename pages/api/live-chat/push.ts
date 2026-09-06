import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getVapidPublicKey, sendLiveChatPushNotification } from "@/lib/live-chat/push";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    try {
      const publicKey = getVapidPublicKey(db);
      return res.status(200).json({ publicKey });
    } catch (err: any) {
      console.error("[Live Chat Push API] GET public key error:", err);
      return res.status(500).json({ error: "Error obteniendo clave pública VAPID" });
    }
  }

  if (req.method === "POST") {
    try {
      const { action = "subscribe", subscription, userEmail } = req.body;

      if (action === "test") {
        const result = await sendLiveChatPushNotification(db, {
          title: "🔔 Prueba Push InHubFlow",
          body: "¡Configuración exitosa! Recibirás alertas aquí cuando un cliente requiera atención humana, incluso si cierras la app.",
        });
        return res.status(200).json({ success: true, result });
      }

      if (action === "unsubscribe") {
        if (subscription?.endpoint) {
          db.prepare("UPDATE live_chat_push_subscriptions SET active = 0, updated_at = datetime('now') WHERE endpoint = ?")
            .run(subscription.endpoint);
        }
        return res.status(200).json({ success: true });
      }

      // Default: Subscribe
      if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        return res.status(400).json({ error: "Datos de suscripción Push inválidos" });
      }

      const id = randomUUID();
      const userAgent = req.headers["user-agent"] || null;

      db.prepare(`
        INSERT INTO live_chat_push_subscriptions (
          id, endpoint, p256dh, auth, user_email, user_agent, active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT(endpoint) DO UPDATE SET
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_email = COALESCE(excluded.user_email, live_chat_push_subscriptions.user_email),
          user_agent = COALESCE(excluded.user_agent, live_chat_push_subscriptions.user_agent),
          active = 1,
          last_error = NULL,
          updated_at = datetime('now')
      `).run(
        id,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        userEmail || null,
        userAgent
      );

      return res.status(200).json({ success: true, message: "Suscripción Push guardada" });
    } catch (err: any) {
      console.error("[Live Chat Push API] POST error:", err);
      return res.status(500).json({ error: "Error procesando suscripción Push" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Método no permitido" });
}
