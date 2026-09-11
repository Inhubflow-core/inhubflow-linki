import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { canonicalLinkedInVanity } from "@/lib/linkedin/connection-reconciliation";
import { captureSdrInboundMessage } from "@/lib/sdr-agent/repository";

function normalizeString(str?: string | null): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();
  const { accountId, observations } = req.body || {};

  if (!accountId) {
    return res.status(400).json({ error: "Missing accountId" });
  }

  const account = db.prepare("SELECT id, is_authenticated, extension_active FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number; extension_active: number }
    | undefined;

  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }

  // Auto-heal authenticated status
  db.prepare(`
    UPDATE accounts 
    SET is_authenticated = 1, 
        extension_active = 1,
        linkedin_inbox_synced_at = datetime('now')
    WHERE id = ?
  `).run(accountId);

  if (!Array.isArray(observations) || observations.length === 0) {
    return res.json({ ok: true, captured: 0, message: "No observations to process" });
  }

  // Load all targets messaged from this account across active or completed runs
  const targets = db.prepare(`
    SELECT t.id, t.full_name, t.linkedin_url, t.messaging_urn, t.last_replied_at,
           rp.run_id, r.workflow_id
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN runs r ON r.id = rp.run_id
    WHERE r.account_id = ?
    ORDER BY rp.created_at DESC
  `).all(accountId) as Array<{
    id: string;
    full_name: string | null;
    linkedin_url: string | null;
    messaging_urn: string | null;
    last_replied_at: string | null;
    run_id: string;
    workflow_id: string | null;
  }>;

  const insert = db.prepare(`
    INSERT INTO linkedin_inbox_messages (
      id, account_id, target_id, run_id, workflow_id,
      external_thread_id, external_message_id, direction,
      sender_external_id, sender_name, body, sent_at, identity_mode, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'extension_sync', ?)
    ON CONFLICT(account_id, external_thread_id, external_message_id) DO NOTHING
  `);

  const updateTargetReply = db.prepare(`
    UPDATE targets
    SET last_replied_at = ?,
        last_replied_account_id = ?
    WHERE id = ?
  `);

  const stopTracks = db.prepare(`
    UPDATE run_profile_tracks
    SET state = 'skipped', next_step_at = NULL, error_message = 'Lead replied via LinkedIn'
    WHERE state NOT IN ('completed', 'failed', 'skipped')
      AND run_profile_id IN (
        SELECT rp.id
        FROM run_profiles rp
        JOIN runs r ON r.id = rp.run_id
        WHERE rp.target_id = ? AND r.account_id = ?
      )
  `);

  let captured = 0;
  let duplicates = 0;

  for (const obs of observations) {
    if (!obs.body || typeof obs.body !== "string" || !obs.body.trim()) continue;

    const direction = obs.direction === "outbound" ? "outbound" : "inbound";
    const senderVanity = canonicalLinkedInVanity(obs.senderProfileUrl);
    const senderName = normalizeString(obs.senderName);
    const senderUrn = (obs.senderMessagingUrn || obs.senderExternalId || "").trim();
    const explicitTargetId = typeof obs.targetId === "string" ? obs.targetId.trim() : null;

    // Match candidate target
    const target = targets.find((t) => {
      if (explicitTargetId && t.id === explicitTargetId) return true;
      if (senderVanity) {
        const tVanity = canonicalLinkedInVanity(t.linkedin_url);
        if (tVanity && normalizeString(tVanity) === normalizeString(senderVanity)) return true;
      }
      if (senderName && t.full_name) {
        const tName = normalizeString(t.full_name);
        if (tName === senderName || tName.includes(senderName) || senderName.includes(tName)) return true;
      }
      if (senderUrn && t.messaging_urn && (t.messaging_urn.trim() === senderUrn || senderUrn.includes(t.messaging_urn.trim()))) {
        return true;
      }
      return false;
    });

    if (!target) {
      continue;
    }

    const messageId = obs.externalMessageId || randomUUID();
    const threadId = obs.externalThreadId || `thread_${target.id}`;
    const sentAt = obs.receivedAt ? new Date(obs.receivedAt).toISOString() : new Date().toISOString();
    const metadata = JSON.stringify({
      source: "extension_inbox_sync",
      senderName: obs.senderName,
      senderProfileUrl: obs.senderProfileUrl,
    });

    try {
      const res = insert.run(
        randomUUID(),
        accountId,
        target.id,
        target.run_id,
        target.workflow_id,
        threadId,
        messageId,
        direction,
        obs.senderExternalId || senderUrn || null,
        obs.senderName || target.full_name,
        obs.body.trim(),
        sentAt,
        metadata
      );

      if (res.changes === 1) {
        captured++;
        if (direction === "inbound") {
          updateTargetReply.run(sentAt, accountId, target.id);
          stopTracks.run(target.id, accountId);

          try {
            captureSdrInboundMessage(db, {
              eventId: `linkedin-campaign:${accountId}:${messageId}`,
              channel: "linkedin",
              targetId: target.id,
              accountId,
              externalThreadId: threadId,
              externalMessageId: messageId,
              senderExternalId: obs.senderExternalId || senderUrn || null,
              senderName: obs.senderName || target.full_name,
              body: obs.body.trim(),
              receivedAt: sentAt,
              metadata: {
                source: "extension_inbox_sync",
                campaignRunId: target.run_id,
                campaignWorkflowId: target.workflow_id,
              },
            });
          } catch (sdrErr) {
            console.warn("[inbox-sync] Non-blocking SDR error:", sdrErr);
          }
        }
      } else {
        duplicates++;
      }
    } catch (err) {
      console.warn("[inbox-sync] Error inserting message:", err);
    }
  }

  console.log(`[inbox-sync] Sincronización completada: ${captured} mensajes nuevos capturados, ${duplicates} duplicados.`);
  return res.json({ ok: true, captured, duplicates });
}
