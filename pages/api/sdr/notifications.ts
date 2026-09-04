import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { listUserNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();

  if (req.method === "GET") {
    const rawState = Array.isArray(req.query.state) ? req.query.state[0] : req.query.state;
    const state = rawState === "unread" || rawState === "read" ? rawState : "all";
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = rawLimit ? Math.min(100, Math.max(1, Number(rawLimit) || 30)) : 30;
    const rawSince = Array.isArray(req.query.since) ? req.query.since[0] : req.query.since;
    const result = listUserNotifications(db, {
      userId: actor.id,
      workspaceOwnerId: actor.workspaceOwnerId,
      state,
      limit,
      since: typeof rawSince === "string" ? rawSince : undefined,
    });
    return res.status(200).json({
      ok: true,
      unreadCount: result.unreadCount,
      notifications: result.notifications.map((notification) => ({
        id: notification.id,
        type: notification.notification_type,
        priority: notification.priority,
        title: notification.title,
        body: notification.body,
        href: notification.href,
        entityType: notification.entity_type,
        entityId: notification.entity_id,
        threadId: notification.thread_id,
        handoffId: notification.handoff_id,
        messageId: notification.message_id,
        data: JSON.parse(notification.data_json || "{}") as Record<string, unknown>,
        state: notification.state,
        createdAt: notification.created_at,
        readAt: notification.read_at,
      })),
    });
  }

  if (req.method === "PATCH" || req.method === "POST") {
    const notificationId = typeof req.body?.id === "string"
      ? req.body.id
      : typeof req.query.id === "string" ? req.query.id : "";
    if (req.body?.all === true) {
      const count = markAllNotificationsRead(db, actor.id, actor.workspaceOwnerId);
      return res.status(200).json({ ok: true, marked: count });
    }
    if (!notificationId) return res.status(400).json({ error: "Notification id is required" });
    const notification = markNotificationRead(db, notificationId, actor.id, actor.workspaceOwnerId);
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    return res.status(200).json({ ok: true, notificationId });
  }

  res.setHeader("Allow", ["GET", "PATCH", "POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}
