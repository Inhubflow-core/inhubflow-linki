import type { Page } from "playwright";
import { visitProfile } from "./visit";

export class NotConnectedError extends Error {}

export interface SendMessageResult {
  messagingUrn: string | null;
  isFirstDegree: boolean;
}

/**
 * Sends a message to a LinkedIn 1st-degree connection.
 *
 * Self-contained URN resolution — does NOT depend on a prior 'visit' workflow
 * step. If messagingUrn is already cached, it's used directly (no extra page
 * load). Otherwise this does its own live profile check to fetch a fresh URN and
 * verify the target is still actually connected, immediately before sending.
 */
export async function sendMessage(
  page: Page,
  fullName: string,
  text: string,
  linkedinUrl: string,
  messagingUrn?: string | null,
  attachmentPath?: string | null,
): Promise<SendMessageResult> {
  // 1. If messagingUrn is cached, try direct compose URL
  if (messagingUrn) {
    const opened = await openComposeByUrn(page, messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text, attachmentPath);
      return { messagingUrn, isFirstDegree: true };
    }
  }

  // 2. Visit profile directly to check connection and find message action
  const resolved = await visitProfile(page, linkedinUrl);
  if (resolved.messagingUrn) {
    const opened = await openComposeByUrn(page, resolved.messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text, attachmentPath);
      return resolved;
    }
  }

  // 3. If on profile and detected as 1st-degree, open compose box directly from page button
  if (resolved.isFirstDegree) {
    const openedOnPage = await openComposeFromProfilePage(page);
    if (openedOnPage) {
      await sendFromComposeBox(page, text, attachmentPath);
      return resolved;
    }
  }

  if (!resolved.isFirstDegree) {
    throw new NotConnectedError(`${fullName} is not a 1st-degree connection — refusing to message`);
  }

  // 4. Connected, but compose URN not found — fallback to name search
  await sendMessageViaTypeahead(page, fullName, text, attachmentPath);
  return resolved;
}

async function openComposeFromProfilePage(page: Page): Promise<boolean> {
  try {
    // 1. Locate the top profile card container containing h1
    const topCard = page.locator("main section, main > div, .pv-top-card")
      .filter({ has: page.locator("h1") })
      .first();
    const topCardFound = (await topCard.count().catch(() => 0)) > 0;
    const headerCard = topCardFound ? topCard : page.locator("main").first();

    // 2. Find message button or link strictly within headerCard
    const candidateElements = headerCard.locator("button:visible, a:visible, div[role='button']:visible");
    const elCount = await candidateElements.count().catch(() => 0);

    let targetElement: import("playwright").Locator | null = null;
    let targetHref: string | null = null;

    for (let i = 0; i < elCount; i++) {
      const el = candidateElements.nth(i);
      const [rawText, rawAria, rawHref] = await Promise.all([
        el.innerText().catch(() => ""),
        el.getAttribute("aria-label").then((v) => v ?? "").catch(() => ""),
        el.getAttribute("href").then((v) => v ?? "").catch(() => ""),
      ]);
      const text = rawText.replace(/\s+/g, " ").trim().toLowerCase();
      const aria = rawAria.replace(/\s+/g, " ").trim().toLowerCase();

      const isMessage =
        /^(?:mensaje|message|mensagem|enviar mensaje|send message|enviar mensagem|envoyer|envoyer un message)$/i.test(text) ||
        /^(?:mensaje|message|mensagem|enviar mensaje|send message|enviar mensagem|envoyer|envoyer un message)\b/i.test(aria) ||
        rawHref.includes("/messaging/compose") ||
        rawHref.includes("/messaging/thread");

      if (isMessage) {
        targetElement = el;
        targetHref = rawHref;
        break;
      }
    }

    if (!targetElement) {
      console.warn("[message] openComposeFromProfilePage: message action not found in profile header");
      return false;
    }

    if (targetHref && targetHref.includes("/messaging/")) {
      const targetUrl = targetHref.startsWith("http") ? targetHref : `https://www.linkedin.com${targetHref}`;
      console.log(`[message] Following direct messaging link from profile: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    } else {
      await targetElement.scrollIntoViewIfNeeded().catch(() => {});
      await targetElement.click();
    }
    await page.waitForTimeout(2000);

    // 3. Handle floating overlay bubble (might be minimized or behind another window)
    const conversationBubble = page.locator(".msg-overlay-conversation-bubble").last();
    if ((await conversationBubble.count().catch(() => 0)) > 0) {
      const box = await conversationBubble.boundingBox().catch(() => null);
      if (box && box.height < 100) {
        const bubbleHeader = conversationBubble.locator("header, .msg-overlay-bubble-header, button[data-control-name*='overlay']").first();
        await bubbleHeader.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    } else {
      const minimizedBubble = page.locator(`
        .msg-overlay-bubble-header--is-minimized,
        .msg-overlay-conversation-bubble--is-minimized,
        aside.msg-overlay-container header.msg-overlay-bubble-header,
        button[data-control-name="overlay.expand_conversation_window"],
        button[aria-label*="maximizar" i],
        button[aria-label*="expand" i]
      `).first();
      if (await minimizedBubble.isVisible().catch(() => false)) {
        await minimizedBubble.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    // 4. Wait for the compose textbox
    const msgInput = page.locator(`
      div.msg-form__contenteditable[contenteditable="true"],
      div.msg-form__contenteditable,
      div[role="textbox"][contenteditable="true"],
      div[role="textbox"].msg-form__message-texteditor,
      div.msg-form__message-texteditor,
      .msg-overlay-conversation-bubble div[role="textbox"],
      .msg-overlay-conversation-bubble [contenteditable="true"],
      p.msg-form__contenteditable,
      div[role="textbox"],
      div[aria-label*="mensaje" i],
      div[aria-label*="message" i],
      div[aria-label*="mensagem" i]
    `).first();

    await msgInput.waitFor({ state: "visible", timeout: 12000 });
    await msgInput.focus().catch(() => {});
    return true;
  } catch (err) {
    console.warn("[message] openComposeFromProfilePage error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function openComposeByUrn(page: Page, messagingUrn: string): Promise<boolean> {
  try {
    const recipientId = messagingUrn.split(":").pop();
    const composeUrl = `https://www.linkedin.com/messaging/compose/?profileUrn=${encodeURIComponent(messagingUrn)}&recipient=${recipientId}`;
    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const msgInput = page.locator(`
      div.msg-form__contenteditable[contenteditable="true"],
      div.msg-form__contenteditable,
      div[role="textbox"][contenteditable="true"],
      div[role="textbox"].msg-form__message-texteditor,
      div.msg-form__message-texteditor,
      .msg-overlay-conversation-bubble div[role="textbox"],
      .msg-overlay-conversation-bubble [contenteditable="true"],
      p.msg-form__contenteditable,
      div[role="textbox"],
      div[aria-label*="mensaje" i],
      div[aria-label*="message" i],
      div[aria-label*="mensagem" i]
    `).first();

    await msgInput.waitFor({ state: "visible", timeout: 12000 });
    await msgInput.focus().catch(() => {});
    return true;
  } catch (err) {
    console.warn("[message] openComposeByUrn failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function sendMessageViaTypeahead(page: Page, fullName: string, text: string, attachmentPath?: string | null): Promise<void> {
  await page.goto("https://www.linkedin.com/messaging/thread/new/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2500);

  // If redirected to /messaging/ without an active composer, click "Compose" button
  const composeTrigger = page.locator(`
    a[href*="/messaging/thread/new/"]:visible,
    button.msg-conversations-container__compose-btn:visible,
    button[aria-label*="Redactar" i]:visible,
    button[aria-label*="Compose" i]:visible,
    button[aria-label*="Escrever" i]:visible,
    button[aria-label*="New message" i]:visible,
    button[aria-label*="Nuevo mensaje" i]:visible,
    button:has(svg[data-test-icon*="compose"]):visible,
    button:has(li-icon[type*="compose"]):visible
  `).first();

  const searchFieldLocator = `
    input.msg-connections-typeahead__search-field,
    input[name="search"],
    input[role="combobox"],
    input[placeholder*="Type a name" i],
    input[placeholder*="Escribe un nombre" i],
    input[placeholder*="Digite um nome" i],
    input[placeholder*="nombre" i],
    input[placeholder*="name" i],
    input[placeholder*="nome" i],
    input[aria-label*="Type a name" i],
    input[aria-label*="Escribe un nombre" i],
    input[aria-label*="Digite um nome" i],
    input[aria-label*="nombre" i],
    input[aria-label*="name" i],
    input[aria-label*="nome" i],
    input[aria-label*="destinatario" i],
    input[aria-label*="recipient" i],
    .msg-connections-typeahead input,
    form.msg-connections-typeahead input,
    .msg-compose input
  `;

  let searchField = page.locator(searchFieldLocator).first();
  const searchVisible = await searchField.isVisible().catch(() => false);

  if (!searchVisible && (await composeTrigger.count().catch(() => 0)) > 0 && (await composeTrigger.isVisible().catch(() => false))) {
    await composeTrigger.click().catch(() => {});
    await page.waitForTimeout(1500);
    searchField = page.locator(searchFieldLocator).first();
  }

  await searchField.waitFor({ state: "visible", timeout: 15000 });
  await searchField.click();
  await searchField.fill("");
  await searchField.pressSequentially(fullName, { delay: 60 + Math.random() * 40 });
  await page.waitForTimeout(2000);

  const firstResult = page.locator(`
    div[class*="msg-connections-typeahead__search-result-row"],
    li[class*="msg-connections-typeahead__result-item"],
    [role="option"]
  `).first();
  await firstResult.waitFor({ state: "visible", timeout: 8000 });
  const resultText = (await firstResult.innerText().catch(() => "")).trim();
  if (!resultNameMatches(resultText, fullName)) {
    throw new Error(
      `Typeahead search for "${fullName}" returned a non-matching result ("${resultText.replace(/\s+/g, " ")}") — refusing to send to avoid messaging the wrong person`
    );
  }
  await firstResult.click({ delay: 100 });
  await page.waitForTimeout(1000);

  await sendFromComposeBox(page, text, attachmentPath);
}

export function resultNameMatches(resultText: string, fullName: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const target = normalize(fullName);
  if (!target) return false;
  return normalize(resultText).includes(target);
}

async function attachFileInCompose(page: Page, filePath: string): Promise<boolean> {
  try {
    const isDoc = /\.pdf|\.doc|\.docx|\.xls|\.xlsx|\.txt/i.test(filePath);
    const fileInputs = page.locator("input[type='file']");
    const count = await fileInputs.count();
    let uploaded = false;

    if (count > 0) {
      if (isDoc) {
        const docBtn = page.locator("button.msg-form__attachment-btn--doc, button[aria-label*='document'], button[aria-label*='archivo'], button[aria-label*='documento']").first();
        if (await docBtn.isVisible().catch(() => false)) {
          await docBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
      }

      for (let i = 0; i < count; i++) {
        try {
          await fileInputs.nth(i).setInputFiles(filePath);
          uploaded = true;
          break;
        } catch { /* continue */ }
      }
    }

    if (uploaded) {
      await page.waitForTimeout(2500);

      // Confirm LinkedIn document upload modal if present
      const modalPrimaryBtn = page.locator(`
        .artdeco-modal button.artdeco-button--primary,
        .share-promoted-document-modal__primary-button,
        div[role='dialog'] button:has-text('Done'),
        div[role='dialog'] button:has-text('Listo'),
        div[role='dialog'] button:has-text('Hecho'),
        div[role='dialog'] button:has-text('Continuar'),
        div[role='dialog'] button:has-text('Save'),
        div[role='dialog'] button:has-text('Guardar'),
        div[role='dialog'] button:has-text('Concluir'),
        div[role='dialog'] button:has-text('Salvar'),
        div[role='dialog'] button:has-text('Pronto')
      `).first();

      if (await modalPrimaryBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await modalPrimaryBtn.click({ delay: 100 });
        await page.waitForTimeout(2000);
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[attachFileInCompose] error attaching file:", err);
    return false;
  }
}

async function sendFromComposeBox(page: Page, text: string, attachmentPath?: string | null): Promise<void> {
  // 1. If attachment present, attach it first
  if (attachmentPath) {
    await attachFileInCompose(page, attachmentPath);
  }

  // 2. Paste or type text message into compose area if text provided
  if (text?.trim()) {
    const msgInput = page.locator(`
      div.msg-form__contenteditable[contenteditable="true"],
      div.msg-form__contenteditable,
      div[role="textbox"][contenteditable="true"],
      div[role="textbox"].msg-form__message-texteditor,
      div.msg-form__message-texteditor,
      .msg-overlay-conversation-bubble div[role="textbox"],
      .msg-overlay-conversation-bubble [contenteditable="true"],
      p.msg-form__contenteditable,
      div[role="textbox"],
      div[aria-label*="mensaje" i],
      div[aria-label*="message" i],
      div[aria-label*="mensagem" i]
    `).first();

    await msgInput.waitFor({ state: "visible", timeout: 10000 });
    await msgInput.click();
    await page.waitForTimeout(300);

    let pasted = false;
    try {
      await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      await page.waitForTimeout(200);
      await msgInput.press("Control+V");
      await page.waitForTimeout(300);
      const content = await msgInput.innerText().catch(() => "");
      pasted = content.trim().length > 0;
    } catch {
      pasted = false;
    }

    if (!pasted) {
      await msgInput.pressSequentially(text, { delay: 15 });
    }

    // Trigger input events so LinkedIn's Ember/React app enables the Send button
    await page.evaluate(() => {
      const el = document.querySelector('div.msg-form__contenteditable, div[role="textbox"].msg-form__message-texteditor, [contenteditable="true"]');
      if (el) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }).catch(() => {});
    await page.waitForTimeout(600);
  }

  // 3. Send
  const sendBtn = page.locator(`
    button.msg-form__send-button:visible,
    button[type='submit'].msg-form__send-button:visible,
    button.msg-form__send-btn:visible,
    button:has-text("Send"):visible,
    button:has-text("Enviar"):visible,
    button:has-text("Envoyer"):visible,
    button[aria-label*="Send" i]:visible,
    button[aria-label*="Enviar" i]:visible,
    button[aria-label*="Envoyer" i]:visible
  `).first();

  await sendBtn.waitFor({ state: "visible", timeout: 10000 });

  // If sendBtn is disabled, try pressing Space + Backspace in msgInput to trigger state change
  if (await sendBtn.isDisabled().catch(() => false)) {
    const msgInput = page.locator("div.msg-form__contenteditable, div[role='textbox'].msg-form__message-texteditor, [contenteditable='true']").first();
    await msgInput.focus().catch(() => {});
    await page.keyboard.press("Space");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
  }

  await sendBtn.click({ delay: 100 });
  await page.waitForTimeout(3000);
}
