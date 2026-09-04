import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { pushPublicKey } from "@/lib/notifications/push";
import { revokePushSubscription, savePushSubscription } from "@/lib/notifications/service";

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();

  if (req.method === "GET") {
    const publicKey = pushPublicKey();
    return res.status(200).json({
      enabled: Boolean(publicKey),
      publicKey,
    });
  }

  const body = (req.body ?? {}) as SubscriptionBody;
  if (
    typeof body.endpoint !== "string" ||
    typeof body.keys?.p256dh !== "string" ||
    typeof body.keys?.auth !== "string"
  ) {
    return res.status(400).json({ error: "Invalid push subscription" });
  }

  try {
    if (req.method === "POST") {
      const id = savePushSubscription(db, {
        userId: actor.id,
        workspaceOwnerId: actor.workspaceOwnerId,
        endpoint: body.endpoint,
        keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
        userAgent: req.headers["user-agent"] ?? null,
      });
      return res.status(201).json({ ok: true, id });
    }
    if (req.method === "DELETE") {
      const revoked = revokePushSubscription(
        db,
        body.endpoint,
        actor.id,
        actor.workspaceOwnerId,
      );
      return res.status(revoked ? 200 : 404).json({ ok: revoked });
    }
    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Push subscription failed" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "20kb" } } };
