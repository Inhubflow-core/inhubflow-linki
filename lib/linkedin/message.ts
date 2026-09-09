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
  console.log(`[message] Starting sendMessage to "${fullName}" (cached URN: ${messagingUrn || "none"})`);

  // 1. If messagingUrn is cached, try direct compose URL
  if (messagingUrn) {
    console.log(`[message] Attempting openComposeByUrn with cached URN: ${messagingUrn}`);
    const opened = await openComposeByUrn(page, messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text, attachmentPath);
      return { messagingUrn, isFirstDegree: true };
    }
  }

  // 2. Visit profile directly to check connection and find message action
  console.log(`[message] Visiting profile: ${linkedinUrl}`);
  const resolved = await visitProfile(page, linkedinUrl);
  console.log(`[message] Profile resolved: isFirstDegree=${resolved.isFirstDegree}, URN=${resolved.messagingUrn}`);

  if (resolved.messagingUrn) {
    console.log(`[message] Attempting openComposeByUrn with freshly resolved URN: ${resolved.messagingUrn}`);
    const opened = await openComposeByUrn(page, resolved.messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text, attachmentPath);
      return resolved;
    }
  }

  // 3. If on profile and detected as 1st-degree, open compose box directly from page button
  if (resolved.isFirstDegree) {
    console.log(`[message] Attempting openComposeFromProfilePage`);
    const openedOnPage = await openComposeFromProfilePage(page);
    if (openedOnPage) {
      await sendFromComposeBox(page, text, attachmentPath);
      return resolved;
    }
  }

  if (!resolved.isFirstDegree) {
    if (resolved.evidence?.reason === "profile_main_missing") {
      throw new Error(`LinkedIn profile container did not load in time for "${fullName}" — retrying`);
    }
    throw new NotConnectedError(`${fullName} is not a 1st-degree connection — refusing to message`);
  }

  // 4. Connected, but compose URN not found — fallback to LinkedIn Messaging
  console.log(`[message] Falling back to sendMessageViaTypeahead for "${fullName}"`);
  await sendMessageViaTypeahead(page, fullName, text, attachmentPath);
  return resolved;
}

async function openComposeFromProfilePage(page: Page): Promise<boolean> {
  try {
    console.log("[message] openComposeFromProfilePage: locating message button on profile");

    const msgBtn = page.locator(`
      main button:has-text("Enviar mensagem"),
      main button:has-text("Mensagem"),
      main button:has-text("Mensaje"),
      main button:has-text("Message"),
      main button:has-text("Enviar mensaje"),
      main button:has-text("Send message"),
      main a:has-text("Enviar mensagem"),
      main a:has-text("Mensagem"),
      main a:has-text("Mensaje"),
      main a:has-text("Message"),
      main button[aria-label*="mensagem" i],
      main button[aria-label*="mensaje" i],
      main button[aria-label*="message" i],
      main a[href*="/messaging/compose"],
      main a[href*="/messaging/thread/"],
      div[role="main"] button:has-text("Enviar mensagem"),
      div[role="main"] button:has-text("Mensagem"),
      div[role="main"] button:has-text("Mensaje"),
      div[role="main"] button:has-text("Message"),
      div[role="main"] button[aria-label*="mensagem" i],
      div[role="main"] button[aria-label*="mensaje" i],
      div[role="main"] button[aria-label*="message" i]
    `).first();

    const btnCount = await msgBtn.count().catch(() => 0);
    if (btnCount === 0 || !(await msgBtn.isVisible().catch(() => false))) {
      console.warn("[message] openComposeFromProfilePage: message button not found in main");
      return false;
    }

    const href = await msgBtn.getAttribute("href").catch(() => null);
    if (href && href.includes("/messaging/")) {
      const targetUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
      console.log(`[message] Following direct messaging link: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    } else {
      console.log("[message] Clicking message button on profile with Playwright native click");
      await msgBtn.scrollIntoViewIfNeeded().catch(() => {});
      await msgBtn.click({ force: true });
      await page.waitForTimeout(1500);

      // Maximize any minimized conversation bubble via DOM
      await page.evaluate(() => {
        const headers = document.querySelectorAll(
          ".msg-overlay-bubble-header, .msg-overlay-conversation-bubble-header, aside header, button[data-control-name*='overlay']"
        );
        headers.forEach((h) => {
          const bubble = h.closest(".msg-overlay-conversation-bubble, aside, .msg-overlay-container");
          if (bubble) {
            const rect = bubble.getBoundingClientRect();
            if (rect.height < 150) {
              (h as HTMLElement).click();
            }
          }
        });
      });
    }

    // Locate and focus compose textbox — wait up to 12s for it to appear
    const msgInput = page.locator(`
      div.msg-form__contenteditable[contenteditable="true"],
      div.msg-form__contenteditable,
      div[role="textbox"][contenteditable="true"],
      div[role="textbox"].msg-form__message-texteditor,
      div.msg-form__message-texteditor,
      .msg-overlay-conversation-bubble div[role="textbox"],
      .msg-overlay-conversation-bubble [contenteditable="true"],
      div[role="textbox"],
      [contenteditable="true"]
    `).first();

    try {
      await msgInput.waitFor({ state: "visible", timeout: 12000 });
      await msgInput.focus().catch(() => {});
      console.log("[message] openComposeFromProfilePage: compose box successfully focused");
      return true;
    } catch {
      console.warn("[message] openComposeFromProfilePage: compose box not visible within 12s after button click");
      return false;
    }
  } catch (err) {
    console.warn("[message] openComposeFromProfilePage error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function openComposeByUrn(page: Page, messagingUrn: string): Promise<boolean> {
  try {
    const recipientId = messagingUrn.split(":").pop();
    const composeUrl = `https://www.linkedin.com/messaging/compose/?profileUrn=${encodeURIComponent(messagingUrn)}&recipient=${recipientId}`;
    console.log(`[message] Navigating to composeUrl: ${composeUrl}`);
    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

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
      [contenteditable="true"]
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
  console.log(`[message] Navigating directly to /messaging/thread/new/ for: "${fullName}"`);
  await page.goto("https://www.linkedin.com/messaging/thread/new/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2500);

  const searchFieldSelector = `
    input.msg-connections-typeahead__search-field,
    input[name="search"],
    input[role="combobox"],
    input[placeholder*="nombre" i],
    input[placeholder*="name" i],
    input[placeholder*="nome" i],
    input[aria-label*="nombre" i],
    input[aria-label*="name" i],
    input[aria-label*="nome" i],
    input[aria-label*="destinatario" i],
    input[aria-label*="recipient" i],
    .msg-connections-typeahead input,
    form.msg-connections-typeahead input,
    .msg-compose input
  `;

  let searchField = page.locator(searchFieldSelector).first();
  const searchVisible = await searchField.isVisible().catch(() => false);

  if (!searchVisible) {
    console.log("[message] Compose field not visible yet, clicking new message trigger in UI");
    const composeBtn = page.locator(`
      a[href*="/messaging/thread/new/"]:visible,
      button.msg-conversations-container__compose-btn:visible,
      button:has(svg[data-test-icon*="compose"]):visible,
      button[aria-label*="mensagem" i]:visible,
      button[aria-label*="message" i]:visible,
      button[aria-label*="mensaje" i]:visible,
      button[aria-label*="compose" i]:visible
    `).first();

    if ((await composeBtn.count().catch(() => 0)) > 0) {
      await composeBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
    } else {
      await triggerNewMessageButton(page);
      await page.waitForTimeout(1500);
    }
    searchField = page.locator(searchFieldSelector).first();
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

async function searchExistingConversation(page: Page, fullName: string): Promise<boolean> {
  try {
    const searchInput = page.locator(`
      input.msg-search-form__search-field,
      input[placeholder*="Buscar mensajes" i],
      input[placeholder*="Search messages" i],
      input[placeholder*="Pesquisar mensagens" i],
      input[aria-label*="Buscar mensajes" i],
      input[aria-label*="Search messages" i],
      input[placeholder*="Buscar" i],
      input[placeholder*="Search" i]
    `).first();

    if ((await searchInput.count().catch(() => 0)) === 0 || !(await searchInput.isVisible().catch(() => false))) {
      return false;
    }

    await searchInput.click();
    await searchInput.fill("");
    await searchInput.pressSequentially(fullName, { delay: 40 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    const convItems = page.locator(".msg-conversations-container__conversations-list li, .msg-conversation-listitem");
    const count = await convItems.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      const item = convItems.nth(i);
      const rowText = await item.innerText().catch(() => "");
      if (resultNameMatches(rowText, fullName)) {
        await item.click();
        await page.waitForTimeout(1500);
        const composeBox = page.locator("div.msg-form__contenteditable, [contenteditable='true']").first();
        if (await composeBox.isVisible({ timeout: 4000 }).catch(() => false)) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function triggerNewMessageButton(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const direct = document.querySelector<HTMLElement>(
        'a[href*="/messaging/thread/new"], button.msg-conversations-container__compose-btn, [data-control-name="compose_message"]'
      );
      if (direct) {
        direct.click();
        return true;
      }
      const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a"));
      for (const b of buttons) {
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        const href = (b.getAttribute("href") || "").toLowerCase();
        if (
          href.includes("/messaging/thread/new") ||
          aria.includes("mensaje nuevo") ||
          aria.includes("nuevo mensaje") ||
          aria.includes("crear un mensaje") ||
          aria.includes("escribir un mensaje") ||
          aria.includes("redactar") ||
          aria.includes("compose") ||
          aria.includes("nova mensagem") ||
          aria.includes("escrever") ||
          b.querySelector('svg[data-test-icon*="compose"], li-icon[type*="compose"]')
        ) {
          b.click();
          return true;
        }
      }
      return false;
    });
  } catch {
    return false;
  }
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
