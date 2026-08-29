import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { getSessionPage } from "@/lib/linkedin/session";
import { sendMessage } from "@/lib/linkedin/message";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { targetId, accountId, messageText, threadId } = req.body ?? {};

  if (!targetId || !accountId || !messageText?.trim()) {
    return res.status(400).json({ error: "Missing required fields (targetId, accountId, messageText)" });
  }

  const db = getDb();
  const target = db.prepare("SELECT id, full_name, linkedin_url, messaging_urn FROM targets WHERE id = ?").get(targetId) as
    | { id: string; full_name: string; linkedin_url: string; messaging_urn?: string | null }
    | undefined;

  if (!target) return res.status(404).json({ error: "Target not found" });

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

  let page;
  try {
    page = await getSessionPage(accountId);
    let sent = false;

    // 1. Try sending directly into active thread if threadId is provided
    if (threadId && !threadId.startsWith("thread-")) {
      try {
        const threadUrl = `https://www.linkedin.com/messaging/thread/${encodeURIComponent(threadId)}/`;
        await page.goto(threadUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);

        const composeBox = page.locator("div.msg-form__contenteditable, div[role='textbox'].msg-form__message-texteditor").first();
        if (await composeBox.isVisible({ timeout: 5000 }).catch(() => false)) {
          await composeBox.click();
          await page.keyboard.type(messageText.trim(), { delay: 15 });
          await page.waitForTimeout(500);

          const sendBtn = page.locator("button.msg-form__send-button, button[type='submit'].msg-form__send-btn").first();
          if (await sendBtn.isVisible().catch(() => false) && !(await sendBtn.isDisabled().catch(() => true))) {
            await sendBtn.click();
            await page.waitForTimeout(2000);
            sent = true;
          }
        }
      } catch {
        // Fallback to profile compose
      }
    }

    // 2. Fallback to standard LinkedIn messaging by profile / URN / typeahead
    if (!sent) {
      await sendMessage(page, target.full_name, messageText.trim(), target.linkedin_url, target.messaging_urn);
    }

    // 3. Persist outbound message in database
    const messageId = `outbound-${crypto.randomUUID()}`;
    const externalThreadId = threadId || `thread-${target.id}`;
    const externalMessageId = `msg-${Date.now()}`;
    const sentAt = new Date().toISOString();

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
      messageText.trim(),
      sentAt,
      JSON.stringify({ source: "inbox-chat-reply" })
    );

    // 4. Update logs
    if (runProfile?.run_id) {
      db.prepare(`
        INSERT INTO logs (id, run_id, target_id, message, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(crypto.randomUUID(), runProfile.run_id, targetId, `Outbound chat message sent to ${target.full_name}`);
    }

    return res.status(200).json({ ok: true, messageId, sentAt });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to send message via LinkedIn",
    });
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }
}
