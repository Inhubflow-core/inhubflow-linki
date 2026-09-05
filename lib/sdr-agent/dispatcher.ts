import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { recordSdrAuditEvent } from "@/lib/audit";
import { getSessionPage } from "@/lib/linkedin/session";
import { sendMessage } from "@/lib/linkedin/message";
import { sendEmail } from "@/lib/email/sender";
import { decryptSecret } from "@/lib/crypto";
import { getSdrThread } from "./repository";

export interface DispatchSdrActionOptions {
  actionId: string;
  actorUserId: string;
  workspaceOwnerId: string;
  editedBody?: string;
}

export interface DispatchSdrActionResult {
  success: boolean;
  actionId: string;
  threadId: string;
  channel: "linkedin" | "email";
  deliveryStatus: "delivered" | "failed";
  error?: string;
  messageId?: string;
}

interface SdrActionRow {
  id: string;
  workspace_owner_id: string | null;
  decision_id: string;
  thread_id: string;
  message_id: string | null;
  action_type: string;
  state: string;
  control_epoch: number;
  payload_json: string;
  edited_payload_json: string | null;
}

export async function dispatchApprovedSdrAction(
  db: Database.Database,
  options: DispatchSdrActionOptions,
): Promise<DispatchSdrActionResult> {
  const action = db.prepare(`
    SELECT * FROM sdr_actions WHERE id = ?
  `).get(options.actionId) as SdrActionRow | undefined;

  if (!action) {
    throw new Error(`SDR Action ${options.actionId} not found`);
  }

  const thread = getSdrThread(db, action.thread_id);
  if (!thread) {
    throw new Error(`SDR Thread ${action.thread_id} not found`);
  }

  // Fail-closed epoch check: ensure no human takeover happened concurrently
  if (thread.control_epoch !== action.control_epoch) {
    throw new Error("El hilo de conversación fue modificado o tomado por un humano (control epoch desalineado).");
  }

  if (["DO_NOT_CONTACT", "RESOLVED"].includes(thread.state)) {
    throw new Error(`No se puede enviar mensajes en un hilo con estado ${thread.state}.`);
  }

  // Parse payload (prioritize edited body if passed or stored)
  let textToSend = options.editedBody?.trim();
  if (!textToSend && action.edited_payload_json) {
    try {
      const parsed = JSON.parse(action.edited_payload_json);
      textToSend = typeof parsed.body === "string" ? parsed.body.trim() : undefined;
    } catch { /* fallback */ }
  }
  if (!textToSend && action.payload_json) {
    try {
      const parsed = JSON.parse(action.payload_json);
      textToSend = typeof parsed.body === "string" ? parsed.body.trim() : undefined;
    } catch { /* fallback */ }
  }

  if (!textToSend) {
    throw new Error("El borrador de respuesta está vacío o no es válido.");
  }

  const target = db.prepare(`
    SELECT id, full_name, first_name, email, linkedin_url, messaging_urn,
      last_replied_account_id, do_not_contact
    FROM targets WHERE id = ?
  `).get(thread.target_id) as {
    id: string;
    full_name: string | null;
    first_name: string | null;
    email: string | null;
    linkedin_url: string | null;
    messaging_urn: string | null;
    last_replied_account_id: string | null;
    do_not_contact: number | null;
  } | undefined;

  if (!target) {
    throw new Error(`Prospecto ${thread.target_id} no encontrado.`);
  }

  if (target.do_not_contact) {
    throw new Error("El prospecto está marcado como 'No contactar' (Do Not Contact).");
  }

  const channel = (thread.channel === "email" ? "email" : "linkedin") as "linkedin" | "email";
  const externalMessageId = `sdr-outbound-${randomUUID()}`;

  if (channel === "linkedin") {
    // 1. Resolve LinkedIn Account
    const accountId = thread.linkedin_account_id || target.last_replied_account_id;
    if (!accountId) {
      throw new Error("No hay una cuenta de LinkedIn asignada a esta conversación.");
    }

    const account = db.prepare(`
      SELECT id, name, is_authenticated FROM accounts WHERE id = ?
    `).get(accountId) as { id: string; name: string; is_authenticated: number } | undefined;

    if (!account || account.is_authenticated !== 1) {
      throw new Error(`La cuenta de LinkedIn ${account?.name || accountId} no está autenticada.`);
    }

    let page;
    let sent = false;
    try {
      page = await getSessionPage(accountId);

      // Try active thread URL first if external_thread_id is available
      if (thread.external_thread_id && !thread.external_thread_id.startsWith("thread-")) {
        try {
          const threadUrl = `https://www.linkedin.com/messaging/thread/${encodeURIComponent(thread.external_thread_id)}/`;
          await page.goto(threadUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(2000);

          const composeBox = page.locator("div.msg-form__contenteditable, div[role='textbox'].msg-form__message-texteditor").first();
          if (await composeBox.isVisible({ timeout: 5000 }).catch(() => false)) {
            await composeBox.click();
            await page.keyboard.type(textToSend, { delay: 15 });
            await page.waitForTimeout(500);

            const sendBtn = page.locator("button.msg-form__send-button, button[type='submit'].msg-form__send-btn").first();
            if (await sendBtn.isVisible({ timeout: 5000 }).catch(() => false) && !(await sendBtn.isDisabled().catch(() => true))) {
              await sendBtn.click();
              await page.waitForTimeout(2500);
              sent = true;
            }
          }
        } catch {
          // Fallback to profile message
        }
      }

      if (!sent) {
        if (!target.linkedin_url) {
          throw new Error("El prospecto no tiene URL de perfil de LinkedIn para enviar el mensaje.");
        }
        await sendMessage(
          page,
          target.full_name || "Contacto",
          textToSend,
          target.linkedin_url,
          target.messaging_urn,
        );
        sent = true;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      db.prepare(`
        UPDATE sdr_actions
        SET state = 'failed', delivery_status = 'failed', updated_at = datetime('now')
        WHERE id = ?
      `).run(action.id);
      throw new Error(`Error al enviar mensaje por LinkedIn: ${errorMsg}`);
    }

    // Persist outbound in LinkedIn inbox table and SDR messages table
    db.transaction(() => {
      db.prepare(`
        INSERT INTO linkedin_inbox_messages (
          id, account_id, target_id, external_thread_id, external_message_id,
          direction, body, sent_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, 'outbound', ?, datetime('now'), ?)
        ON CONFLICT(account_id, external_message_id) DO NOTHING
      `).run(
        randomUUID(),
        accountId,
        target.id,
        thread.external_thread_id || `thread-${target.id}`,
        externalMessageId,
        textToSend,
        JSON.stringify({ sentVia: "sdr_action_dispatch", actionId: action.id }),
      );

      db.prepare(`
        INSERT INTO sdr_messages (
          id, thread_id, direction, external_message_id, sender_type,
          body, sent_at, delivery_status
        ) VALUES (?, ?, 'outbound', ?, 'agent', ?, datetime('now'), 'delivered')
        ON CONFLICT(external_message_id) DO NOTHING
      `).run(
        randomUUID(),
        thread.id,
        externalMessageId,
        textToSend,
      );

      db.prepare(`
        UPDATE sdr_actions
        SET state = 'completed', delivery_status = 'delivered',
          approved_by_user_id = COALESCE(approved_by_user_id, ?),
          approved_at = COALESCE(approved_at, datetime('now')),
          edited_payload_json = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(options.actorUserId, JSON.stringify({ body: textToSend }), action.id);

      db.prepare(`
        UPDATE sdr_threads
        SET state = 'WAITING_LEAD', latest_processed_message_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(action.message_id || externalMessageId, thread.id);
    })();
  } else {
    // 2. Email Channel
    const emailAccountId = thread.email_account_id;
    if (!emailAccountId) {
      throw new Error("No hay una cuenta de Email asignada a esta conversación.");
    }

    if (!target.email) {
      throw new Error("El prospecto no tiene una dirección de correo válida.");
    }

    const emailAccount = db.prepare(`
      SELECT id, from_email, from_name, reply_to, smtp_host, smtp_port,
        smtp_secure, username, password
      FROM email_accounts WHERE id = ?
    `).get(emailAccountId) as {
      id: string;
      from_email: string;
      from_name: string | null;
      reply_to: string | null;
      smtp_host: string;
      smtp_port: number;
      smtp_secure: number;
      username: string;
      password: string;
    } | undefined;

    if (!emailAccount) {
      throw new Error(`Cuenta de correo ${emailAccountId} no encontrada.`);
    }

    let password = emailAccount.password;
    try {
      const decrypted = decryptSecret(emailAccount.password);
      if (decrypted) password = decrypted;
    } catch {
      // not encrypted
    }

    try {
      await sendEmail(
        {
          ...emailAccount,
          password,
        },
        target.email,
        `Re: Conversación con ${emailAccount.from_name || "InHubFlow"}`,
        textToSend,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      db.prepare(`
        UPDATE sdr_actions
        SET state = 'failed', delivery_status = 'failed', updated_at = datetime('now')
        WHERE id = ?
      `).run(action.id);
      throw new Error(`Error al enviar correo: ${errorMsg}`);
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO sdr_messages (
          id, thread_id, direction, external_message_id, sender_type,
          body, sent_at, delivery_status
        ) VALUES (?, ?, 'outbound', ?, 'agent', ?, datetime('now'), 'delivered')
        ON CONFLICT(external_message_id) DO NOTHING
      `).run(
        randomUUID(),
        thread.id,
        externalMessageId,
        textToSend,
      );

      db.prepare(`
        UPDATE sdr_actions
        SET state = 'completed', delivery_status = 'delivered',
          approved_by_user_id = COALESCE(approved_by_user_id, ?),
          approved_at = COALESCE(approved_at, datetime('now')),
          edited_payload_json = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(options.actorUserId, JSON.stringify({ body: textToSend }), action.id);

      db.prepare(`
        UPDATE sdr_threads
        SET state = 'WAITING_LEAD', latest_processed_message_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(action.message_id || externalMessageId, thread.id);
    })();
  }

  recordSdrAuditEvent(db, {
    workspaceOwnerId: options.workspaceOwnerId,
    actorType: "user",
    actorUserId: options.actorUserId,
    entityType: "action",
    entityId: action.id,
    eventType: "sdr_action_dispatched",
    threadId: thread.id,
    actionId: action.id,
    correlationId: externalMessageId,
    idempotencyKey: `audit:dispatch:${action.id}`,
    payload: { channel, length: textToSend.length },
  });

  return {
    success: true,
    actionId: action.id,
    threadId: thread.id,
    channel,
    deliveryStatus: "delivered",
    messageId: externalMessageId,
  };
}
