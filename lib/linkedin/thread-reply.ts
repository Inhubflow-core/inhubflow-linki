import { createHash } from "node:crypto";
import type { Page } from "playwright";
import { canonicalLinkedInVanity } from "./connection-reconciliation";
import { getSessionPage, saveSessionState } from "./session";

export class DeliveryUnknownError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeliveryUnknownError";
  }
}

export interface ExactLinkedInReplyInput {
  accountId: string;
  externalThreadId: string;
  expectedMessagingUrn: string | null;
  expectedProfileUrl: string | null;
  body: string;
}

export interface ExactLinkedInReplyResult {
  providerThreadId: string;
  providerMessageId: string;
  sentAt: string;
}

function conversationPathId(value: string): string {
  const match = value.match(/urn:li:msg_conversation:\((?:[^,]+),(.+)\)$/);
  return match?.[1] ?? value;
}

async function verifyParticipant(page: Page, input: ExactLinkedInReplyInput): Promise<boolean> {
  const expectedVanity = canonicalLinkedInVanity(input.expectedProfileUrl);
  return page.evaluate(
    ({ expectedUrn, expectedVanityValue }) => {
      const nodes = Array.from(document.querySelectorAll("a[href], [data-entity-urn], [data-control-name]"));
      for (const node of nodes) {
        const href = node.getAttribute("href") || "";
        const urn = node.getAttribute("data-entity-urn") || "";
        if (expectedUrn && (urn === expectedUrn || href.includes(encodeURIComponent(expectedUrn)) || href.includes(expectedUrn))) {
          return true;
        }
        if (expectedVanityValue) {
          const match = href.match(/\/in\/([^/?#]+)/i);
          if (match && decodeURIComponent(match[1]).toLowerCase() === expectedVanityValue) return true;
        }
      }
      return false;
    },
    { expectedUrn: input.expectedMessagingUrn, expectedVanityValue: expectedVanity },
  );
}

async function confirmVisibleOutbound(page: Page, body: string): Promise<string | null> {
  return page.evaluate((expectedBody) => {
    const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
    const expected = normalized(expectedBody);
    const candidates = Array.from(document.querySelectorAll(
      ".msg-s-message-list__event, .msg-s-event-listitem, [data-event-urn]",
    )).reverse();
    for (const candidate of candidates) {
      const text = normalized(candidate.textContent || "");
      if (!text.includes(expected)) continue;
      const outboundMarker = candidate.querySelector(
        ".msg-s-message-group__name[href*='/in/'], .msg-s-event-listitem__message-bubble--msg-fwd-enabled",
      );
      if (!outboundMarker && !candidate.className.toString().includes("message-group--is-current-user")) continue;
      return candidate.getAttribute("data-event-urn") || candidate.id || "confirmed-visible";
    }
    return null;
  }, body);
}

export async function sendExactLinkedInThreadReply(
  input: ExactLinkedInReplyInput,
): Promise<ExactLinkedInReplyResult> {
  if (!input.externalThreadId.trim() || input.externalThreadId.startsWith("thread-")) {
    throw new Error("A verified LinkedIn external thread id is required");
  }
  if (!input.expectedMessagingUrn && !canonicalLinkedInVanity(input.expectedProfileUrl)) {
    throw new Error("A verified LinkedIn participant identity is required");
  }
  const body = input.body.trim();
  if (!body || body.length > 8_000) throw new Error("LinkedIn reply must contain 1-8000 characters");

  let page: Page | null = null;
  let clicked = false;
  try {
    page = await getSessionPage(input.accountId);
    const pathId = conversationPathId(input.externalThreadId);
    await page.goto(
      `https://www.linkedin.com/messaging/thread/${encodeURIComponent(pathId)}/`,
      { waitUntil: "domcontentloaded", timeout: 35_000 },
    );
    await page.waitForTimeout(2_000);
    if (/\/login|\/authwall|\/checkpoint|\/uas\//i.test(page.url())) {
      throw new Error("LinkedIn session requires reauthentication");
    }
    if (!await verifyParticipant(page, input)) {
      throw new Error("LinkedIn thread participant identity could not be verified");
    }

    const compose = page.locator(
      "div.msg-form__contenteditable[contenteditable='true'], div[role='textbox'].msg-form__message-texteditor",
    ).first();
    await compose.waitFor({ state: "visible", timeout: 8_000 });
    await compose.click();
    await page.keyboard.type(body, { delay: 12 });
    const send = page.locator(
      "button.msg-form__send-button, button[type='submit'].msg-form__send-btn",
    ).first();
    await send.waitFor({ state: "visible", timeout: 5_000 });
    if (await send.isDisabled()) throw new Error("LinkedIn send button is disabled");
    await send.click();
    clicked = true;
    await page.waitForTimeout(2_500);
    const confirmation = await confirmVisibleOutbound(page, body);
    if (!confirmation) {
      throw new DeliveryUnknownError("LinkedIn send was clicked but delivery confirmation was not observed");
    }
    const sentAt = new Date().toISOString();
    return {
      providerThreadId: input.externalThreadId,
      providerMessageId: confirmation === "confirmed-visible"
        ? `confirmed:${createHash("sha256").update(`${input.externalThreadId}:${body}:${sentAt}`).digest("hex")}`
        : confirmation,
      sentAt,
    };
  } catch (error) {
    if (clicked && !(error instanceof DeliveryUnknownError)) {
      throw new DeliveryUnknownError("LinkedIn delivery outcome is uncertain", { cause: error });
    }
    throw error;
  } finally {
    if (page) {
      if (!/\/login|\/authwall|\/checkpoint|\/uas\//i.test(page.url())) {
        try { await saveSessionState(input.accountId); } catch { /* best effort */ }
      }
      try { await page.close(); } catch { /* best effort */ }
    }
  }
}
