import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb } from "@/lib/db";
import { getSessionPage } from "@/lib/linkedin/session";
import { sendMessage } from "@/lib/linkedin/message";
import { canAccessLinkedInAccount, requireApiActor, targetBelongsToLinkedInAccount } from "@/lib/authz";
import { takeHumanControl } from "@/lib/sdr-agent/handoff";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

interface AttachmentPayload {
  name: string;
  type: string;
  dataUrl: string; // base64 data url
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const { targetId, accountId, messageText, threadId, attachment } = req.body as {
    targetId?: string;
    accountId?: string;
    messageText?: string;
    threadId?: string;
    attachment?: AttachmentPayload | null;
  };

  if (!targetId || !accountId || (!messageText?.trim() && !attachment)) {
    return res.status(400).json({ error: "Missing required fields (targetId, accountId, and messageText or attachment)" });
  }

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) {
    return res.status(404).json({ error: "Account not found" });
  }
  if (!targetBelongsToLinkedInAccount(db, targetId, accountId)) {
    return res.status(404).json({ error: "Target not found for this account" });
  }
  const target = db.prepare("SELECT id, full_name, linkedin_url, messaging_urn FROM targets WHERE id = ?").get(targetId) as
    | { id: string; full_name: string; linkedin_url: string; messaging_urn?: string | null }
    | undefined;

  if (!target) return res.status(404).json({ error: "Target not found" });

  if (threadId) {
    const threadMatches = db.prepare(`
      SELECT 1 FROM linkedin_inbox_messages
      WHERE account_id = ? AND target_id = ? AND external_thread_id = ?
      UNION ALL
      SELECT 1 FROM sdr_threads
      WHERE channel = 'linkedin' AND linkedin_account_id = ?
        AND target_id = ? AND external_thread_id = ?
      LIMIT 1
    `).get(accountId, targetId, threadId, accountId, targetId, threadId);
    if (!threadMatches) return res.status(404).json({ error: "LinkedIn conversation not found" });
  }

  const account = db.prepare("SELECT id, name, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; name: string; is_authenticated: number }
    | undefined;

  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.is_authenticated !== 1) return res.status(400).json({ error: "Account is not authenticated" });

  // Get active run / workflow if available
  const runProfile = db.prepare(`
    SELECT rp.run_id, r.workflow_id
    FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ? AND r.account_id = ?
    LIMIT 1
  `).get(targetId, accountId) as { run_id?: string; workflow_id?: string } | undefined;

  const sdrThread = db.prepare(`
    SELECT id FROM sdr_threads
    WHERE target_id = ? AND channel = 'linkedin' AND linkedin_account_id = ?
      AND (? IS NULL OR external_thread_id = ?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(targetId, accountId, threadId ?? null, threadId ?? null) as { id: string } | undefined;
  if (sdrThread) {
    try {
      takeHumanControl(db, {
        threadId: sdrThread.id,
        actorUserId: actor.id,
        workspaceOwnerId: actor.workspaceOwnerId,
        allowAdministrativeOverride: actor.isWorkspaceAdmin,
      });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Conversation is locked" });
    }
  }

  let page;
  let tempFilePath: string | null = null;

  try {
    // 1. Process attachment if present
    if (attachment && attachment.dataUrl) {
      const match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const base64Data = match ? match[2] : attachment.dataUrl;
      const buffer = Buffer.from(base64Data, "base64");
      const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      tempFilePath = path.join(os.tmpdir(), `inhubflow_${crypto.randomUUID()}_${safeName}`);
      fs.writeFileSync(tempFilePath, buffer);
    }

    page = await getSessionPage(accountId);
    let sent = false;

    // 2. Try sending directly into active thread if threadId is provided
    if (threadId && !threadId.startsWith("thread-")) {
      try {
        const threadUrl = `https://www.linkedin.com/messaging/thread/${encodeURIComponent(threadId)}/`;
        await page.goto(threadUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);

        // Upload attachment if any
        if (tempFilePath) {
          const fileInputs = page.locator("input[type='file']");
          const count = await fileInputs.count();
          let uploaded = false;
          if (count > 0) {
            const isDoc = /\.pdf|\.doc|\.docx|\.xls|\.xlsx|\.txt/i.test(tempFilePath);
            if (isDoc) {
              const docBtn = page.locator("button.msg-form__attachment-btn--doc, button[aria-label*='document'], button[aria-label*='archivo'], button[aria-label*='documento']").first();
              if (await docBtn.isVisible().catch(() => false)) {
                await docBtn.click().catch(() => {});
                await page.waitForTimeout(1000);
              }
            }
            for (let i = 0; i < count; i++) {
              try {
                await fileInputs.nth(i).setInputFiles(tempFilePath);
                uploaded = true;
                break;
              } catch { /* continue */ }
            }
          }
          if (uploaded) {
            await page.waitForTimeout(2500);
            const modalPrimaryBtn = page.locator(`
              .artdeco-modal button.artdeco-button--primary,
              .share-promoted-document-modal__primary-button,
              div[role='dialog'] button:has-text('Done'),
              div[role='dialog'] button:has-text('Listo'),
              div[role='dialog'] button:has-text('Hecho'),
              div[role='dialog'] button:has-text('Continuar'),
              div[role='dialog'] button:has-text('Save'),
              div[role='dialog'] button:has-text('Guardar')
            `).first();

            if (await modalPrimaryBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
              await modalPrimaryBtn.click({ delay: 100 });
              await page.waitForTimeout(2000);
            }
          }
        }

        // Type text message if any
        if (messageText?.trim()) {
          const composeBox = page.locator("div.msg-form__contenteditable, div[role='textbox'].msg-form__message-texteditor").first();
          if (await composeBox.isVisible({ timeout: 5000 }).catch(() => false)) {
            await composeBox.click();
            await page.keyboard.type(messageText.trim(), { delay: 15 });
            await page.waitForTimeout(500);
          }
        }

        const sendBtn = page.locator("button.msg-form__send-button, button[type='submit'].msg-form__send-btn").first();
        if (await sendBtn.isVisible({ timeout: 5000 }).catch(() => false) && !(await sendBtn.isDisabled().catch(() => true))) {
          await sendBtn.click();
          await page.waitForTimeout(3000);
          sent = true;
        }
      } catch {
        // Fallback to profile compose
      }
    }

    // 3. Fallback to standard LinkedIn messaging
    if (!sent) {
      const textToSend = messageText?.trim() || "";
      await sendMessage(page, target.full_name, textToSend, target.linkedin_url, target.messaging_urn, tempFilePath);
    }

    // 4. Persist outbound message in database
    const messageId = `outbound-${crypto.randomUUID()}`;
    const externalThreadId = threadId || `thread-${target.id}`;
    const externalMessageId = `msg-${Date.now()}`;
    const sentAt = new Date().toISOString();
    const finalBody = messageText?.trim()
      ? (attachment ? `${messageText.trim()}\n\n📎 [Archivo: ${attachment.name}]` : messageText.trim())
      : (attachment ? `📎 [Archivo: ${attachment.name}]` : "");

    const metadata = {
      source: "inbox-chat-reply",
      attachment: attachment ? { name: attachment.name, type: attachment.type } : null,
    };

    db.prepare(`
      INSERT INTO linkedin_inbox_messages (
        id, account_id, target_id, run_id, workflow_id,
        external_thread_id, external_message_id, direction,
        sender_external_id, sender_name, body, sent_at, identity_mode, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, 'profile_url', ?)
    `).run(
      messageId,
      accountId,
      targetId,
      runProfile?.run_id ?? null,
      runProfile?.workflow_id ?? null,
      externalThreadId,
      externalMessageId,
      target.linkedin_url,
      account.name || "Me",
      finalBody,
      sentAt,
      JSON.stringify(metadata)
    );

    if (sdrThread) {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO sdr_messages (
            id, thread_id, direction, external_message_id, sender_name, body,
            content_hash, sent_at, captured_at, delivery_status, metadata_json
          ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, 'sent', ?)
          ON CONFLICT(thread_id, external_message_id) DO NOTHING
        `).run(
          crypto.randomUUID(),
          sdrThread.id,
          externalMessageId,
          account.name || "Me",
          finalBody,
          crypto.createHash("sha256").update(finalBody, "utf8").digest("hex"),
          sentAt,
          sentAt,
          JSON.stringify({ source: "human-inbox-reply", channel: "linkedin" }),
        );
        db.prepare(`
          UPDATE sdr_threads SET last_outbound_at = ?, updated_at = datetime('now') WHERE id = ?
        `).run(sentAt, sdrThread.id);
      })();
    }

    // 5. Update logs
    if (runProfile?.run_id) {
      db.prepare(`
        INSERT INTO logs (id, run_id, target_id, message, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(crypto.randomUUID(), runProfile.run_id, targetId, `Outbound chat message sent to ${target.full_name}${attachment ? ` with attachment ${attachment.name}` : ""}`);
    }

    return res.status(200).json({ ok: true, messageId, sentAt, body: finalBody, metadata });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to send message via LinkedIn",
    });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
    }
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }
}
