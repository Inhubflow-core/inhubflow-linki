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
  messagingUrn?: string | null
): Promise<SendMessageResult> {
  // 1. If messagingUrn is cached, try direct compose URL
  if (messagingUrn) {
    const opened = await openComposeByUrn(page, messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text);
      return { messagingUrn, isFirstDegree: true };
    }
  }

  // 2. Visit profile directly to check connection and find message action
  const resolved = await visitProfile(page, linkedinUrl);
  if (resolved.messagingUrn) {
    const opened = await openComposeByUrn(page, resolved.messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text);
      return resolved;
    }
  }

  // 3. If on profile and detected as 1st-degree, open compose box directly from page button
  if (resolved.isFirstDegree) {
    const openedOnPage = await openComposeFromProfilePage(page);
    if (openedOnPage) {
      await sendFromComposeBox(page, text);
      return resolved;
    }
  }

  if (!resolved.isFirstDegree) {
    throw new NotConnectedError(`${fullName} is not a 1st-degree connection — refusing to message`);
  }

  // 4. Connected, but compose URN not found — fallback to name search
  await sendMessageViaTypeahead(page, fullName, text);
  return resolved;
}

async function openComposeFromProfilePage(page: Page): Promise<boolean> {
  try {
    const msgBtn = page.locator(`
      main section button:has-text("Mensagem"),
      main section button:has-text("Message"),
      main section button:has-text("Enviar mensaje"),
      main section button[aria-label*="Mensagem"],
      main section button[aria-label*="Message"],
      main section button[aria-label*="Enviar mensaje"],
      main button:has-text("Mensagem"),
      main button:has-text("Message"),
      main button:has-text("Enviar mensaje"),
      button:has-text("Mensagem"),
      button:has-text("Message"),
      button:has-text("Enviar mensaje")
    `).first();

    if (await msgBtn.isVisible().catch(() => false)) {
      await msgBtn.click({ delay: 100 });
      await page.waitForTimeout(1500 + Math.random() * 1000);
      const msgInput = page.locator("div.msg-form__contenteditable, div[role='textbox'].msg-form__message-texteditor").first();
      await msgInput.waitFor({ timeout: 10000 });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function openComposeByUrn(page: Page, messagingUrn: string): Promise<boolean> {
  try {
    const recipientId = messagingUrn.split(":").pop();
    const composeUrl = `https://www.linkedin.com/messaging/compose/?profileUrn=${encodeURIComponent(messagingUrn)}&recipient=${recipientId}`;
    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500 + Math.random() * 1000);
    const msgInput = page.locator("div.msg-form__contenteditable, div[role='textbox'].msg-form__message-texteditor").first();
    await msgInput.waitFor({ timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function sendMessageViaTypeahead(page: Page, fullName: string, text: string): Promise<void> {
  await page.goto("https://www.linkedin.com/messaging/thread/new/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(1500 + Math.random() * 1000);

  // Search for recipient by name
  const searchField = page.locator("input.msg-connections-typeahead__search-field").first();
  await searchField.waitFor({ timeout: 10000 });
  await searchField.click();
  await searchField.type(fullName, { delay: 60 + Math.random() * 40 });
  await page.waitForTimeout(1500);

  const firstResult = page.locator('div[class*="msg-connections-typeahead__search-result-row"]').first();
  await firstResult.waitFor({ timeout: 8000 });
  const resultText = (await firstResult.innerText().catch(() => "")).trim();
  if (!resultNameMatches(resultText, fullName)) {
    throw new Error(
      `Typeahead search for "${fullName}" returned a non-matching result ("${resultText.replace(/\s+/g, " ")}") — refusing to send to avoid messaging the wrong person`
    );
  }
  await firstResult.click({ delay: 100 });
  await page.waitForTimeout(800);

  await sendFromComposeBox(page, text);
}

function resultNameMatches(resultText: string, fullName: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const target = normalize(fullName);
  if (!target) return false;
  return normalize(resultText).includes(target);
}

async function sendFromComposeBox(page: Page, text: string): Promise<void> {
  // Paste message into compose area
  const msgInput = page.locator("div.msg-form__contenteditable, div[role='textbox'].msg-form__message-texteditor").first();
  await msgInput.waitFor({ timeout: 8000 });
  await msgInput.click();
  try {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.waitForTimeout(300);
    await msgInput.press("Control+V");
  } catch {
    // Clipboard blocked in headless — fall back to keyboard typing
    await msgInput.pressSequentially(text, { delay: 20 });
  }
  await page.waitForTimeout(500);

  // Send
  const sendBtn = page.locator("button.msg-form__send-button:visible, button[type='submit'].msg-form__send-button:visible").first();
  await sendBtn.waitFor({ timeout: 5000 });
  await sendBtn.click({ delay: 100 });
  await page.waitForTimeout(2000);
}
