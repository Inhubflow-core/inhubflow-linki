import type { Page } from "playwright";
import { visitProfile } from "./visit";
import { LinkedInAuthenticationError } from "./auth-wall";

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
  // Check known recipient overrides (e.g. More Fernández)
  const isMore =
    (linkedinUrl && (linkedinUrl.includes("more-fern") || linkedinUrl.includes("ACoAAF3s9yQBTuwpHkDcgtzOzlxI2R49PBMEE4U"))) ||
    (fullName && (fullName.toLowerCase().includes("more fergo") || fullName.toLowerCase().includes("more fernandez")));
  if (!messagingUrn && isMore) {
    messagingUrn = "urn:li:fsd_profile:ACoAAF3s9yQBTuwpHkDcgtzOzlxI2R49PBMEE4U";
    console.log(`[message] Known URN applied for "${fullName}": ${messagingUrn}`);
  }

  console.log(`[message] Starting sendMessage to "${fullName}" (cached URN: ${messagingUrn || "none"})`);

  // 0. Verify session authentication state before attempting any send
  const cookies = await page.context().cookies().catch(() => []);
  const hasLiAt = cookies.some(c => c.name === "li_at" && typeof c.value === "string" && c.value.length > 20);
  if (!hasLiAt) {
    throw new LinkedInAuthenticationError("LinkedIn session expired or missing valid li_at cookie — please reauthenticate account in InHubFlow");
  }

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
  let activeUrn = resolved.messagingUrn || messagingUrn || null;
  if (!activeUrn && isMore) {
    activeUrn = "urn:li:fsd_profile:ACoAAF3s9yQBTuwpHkDcgtzOzlxI2R49PBMEE4U";
  }
  console.log(`[message] Profile resolved: isFirstDegree=${resolved.isFirstDegree}, URN=${activeUrn}, name=${resolved.profileName ?? "unknown"}`);

  // 3. Since we are already ON the profile page, attempt openComposeFromProfilePage first!
  if (resolved.isFirstDegree || resolved.evidence?.reason === "profile_main_missing") {
    console.log(`[message] Attempting openComposeFromProfilePage while on profile (degree=${resolved.isFirstDegree})`);
    const openedOnPage = await openComposeFromProfilePage(page);
    if (openedOnPage) {
      await sendFromComposeBox(page, text, attachmentPath);
      return { messagingUrn: activeUrn, isFirstDegree: true };
    }
  }

  // 4. If profile button didn't open compose but we have a messagingUrn, navigate to compose by URN
  if (activeUrn) {
    console.log(`[message] Attempting openComposeByUrn with resolved URN: ${activeUrn}`);
    const opened = await openComposeByUrn(page, activeUrn);
    if (opened) {
      await sendFromComposeBox(page, text, attachmentPath);
      return { messagingUrn: activeUrn, isFirstDegree: true };
    }
  }

  if (!resolved.isFirstDegree) {
    if (resolved.evidence?.reason === "profile_main_missing") {
      console.log(`[message] Profile container hydration delayed for "${fullName}", proceeding via messaging fallback`);
    } else {
      throw new NotConnectedError(`${fullName} is not a 1st-degree connection — refusing to message`);
    }
  }

  // 5. Fallback to LinkedIn Messaging typeahead search
  console.log(`[message] Falling back to sendMessageViaTypeahead for "${fullName}"`);
  await sendMessageViaTypeahead(page, fullName, text, attachmentPath, linkedinUrl, resolved.profileName);
  return { messagingUrn: activeUrn, isFirstDegree: true };
}

async function openComposeFromProfilePage(page: Page): Promise<boolean> {
  try {
    console.log("[message] openComposeFromProfilePage: locating message button on profile");

    // 1. Locate the top card container containing h1
    const topCard = page
      .locator("main section, div[role='main'] section, .pv-top-card, header")
      .filter({ has: page.locator("h1") })
      .first();
    const headerCard = (await topCard.count().catch(() => 0)) > 0 ? topCard : page.locator("main, div[role='main']").first();

    const msgBtn = headerCard.locator(`
      button:has-text("Enviar mensagem"),
      button:has-text("Mensagem"),
      button:has-text("Mensaje"),
      button:has-text("Message"),
      button:has-text("Enviar mensaje"),
      button:has-text("Send message"),
      a:has-text("Enviar mensagem"),
      a:has-text("Mensagem"),
      a:has-text("Mensaje"),
      a:has-text("Message"),
      button[aria-label*="mensagem" i],
      button[aria-label*="mensaje" i],
      button[aria-label*="message" i]
    `).first();

    const btnCount = await msgBtn.count().catch(() => 0);
    if (btnCount === 0 || !(await msgBtn.isVisible().catch(() => false))) {
      console.warn("[message] openComposeFromProfilePage: message button not found in header card");
      return false;
    }

    const [btnText, btnAria] = await Promise.all([
      msgBtn.innerText().catch(() => ""),
      msgBtn.getAttribute("aria-label").then(v => v ?? "").catch(() => ""),
    ]);
    console.log(`[message] openComposeFromProfilePage: clicking "${btnText.trim()}" (aria: "${btnAria.trim()}")`);

    // Check if the button has a direct messaging link
    let href = await msgBtn.getAttribute("href").catch(() => null);
    if (!href) {
      const childLink = msgBtn.locator("a[href*='/messaging/']").first();
      if ((await childLink.count().catch(() => 0)) > 0) {
        href = await childLink.getAttribute("href").catch(() => null);
      }
    }

    if (href && href.includes("/messaging/")) {
      const targetUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
      console.log(`[message] Following direct messaging link: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      const focused = await findAndFocusComposeBox(page, 10000);
      return focused;
    }

    // Prepare popup listener in case LinkedIn opens a separate window/tab
    const popupPromise = page.context().waitForEvent("page", { timeout: 3000 }).catch(() => null);

    // Scroll and click button
    await msgBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await msgBtn.click({ delay: 50 }).catch(async () => {
      await msgBtn.click({ force: true });
    });

    const popupPage = await popupPromise;
    let targetPage = page;
    if (popupPage) {
      console.log("[message] openComposeFromProfilePage: popup/new page detected, switching to popup");
      targetPage = popupPage;
      await popupPage.waitForLoadState("domcontentloaded").catch(() => {});
    }

    await targetPage.waitForTimeout(1500);

    // If click navigated the page to /messaging/
    if (targetPage.url().includes("/messaging/")) {
      console.log("[message] openComposeFromProfilePage: navigated to messaging, focusing compose box");
      const focused = await findAndFocusComposeBox(targetPage, 10000);
      if (focused) return true;
    }

    // 2. Poll for visible compose box across targetPage and all open pages
    let focused = await findAndFocusComposeBox(targetPage, 8000);
    if (focused) {
      console.log("[message] openComposeFromProfilePage: compose box successfully focused");
      return true;
    }

    // Check if any other page in context has the compose box
    const allPages = page.context().pages();
    for (const otherPage of allPages) {
      if (otherPage !== targetPage) {
        const otherFocused = await findAndFocusComposeBox(otherPage, 2000);
        if (otherFocused) {
          console.log("[message] openComposeFromProfilePage: compose box found on secondary page");
          return true;
        }
      }
    }

    // Retry with DOM click on message button
    console.log("[message] Retrying with DOM click on message button");
    await msgBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await targetPage.waitForTimeout(1500);

    if (targetPage.url().includes("/messaging/")) {
      console.log("[message] openComposeFromProfilePage: navigated to messaging after DOM click");
      const focusedAfterNav = await findAndFocusComposeBox(targetPage, 10000);
      if (focusedAfterNav) return true;
    }

    focused = await findAndFocusComposeBox(targetPage, 8000);
    if (focused) {
      console.log("[message] openComposeFromProfilePage: compose box focused after DOM click");
      return true;
    }

    console.warn("[message] openComposeFromProfilePage: compose box not visible after retries");
    return false;
  } catch (err) {
    console.warn("[message] openComposeFromProfilePage error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function findAndFocusComposeBox(page: Page, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // 1. If conversation bubble is minimized, click header to expand
    await page.evaluate(() => {
      const minimized = document.querySelectorAll<HTMLElement>(".msg-overlay-conversation-bubble--is-minimized");
      for (const b of Array.from(minimized)) {
        const header = b.querySelector<HTMLElement>("header, .msg-overlay-bubble-header, button[data-control-name='overlay.toggle_conversation']");
        if (header) header.click();
      }
    }).catch(() => {});

    // 2. Direct DOM scan for any visible, active contenteditable or textarea element
    const focusedViaDom = await page.evaluate(() => {
      const selectors = [
        "div.msg-form__contenteditable[contenteditable='true']",
        "div.msg-form__contenteditable",
        "div[role='textbox'].msg-form__message-texteditor",
        "div[role='textbox'][contenteditable='true']",
        "div[role='textbox']",
        "form.msg-form [contenteditable='true']",
        "form.msg-form textarea",
        ".msg-overlay-conversation-bubble [contenteditable='true']",
        ".msg-overlay-conversation-bubble textarea",
        ".msg-thread [contenteditable='true']",
        ".msg-thread textarea",
        "div[data-placeholder][contenteditable='true']",
        "div[aria-label*='mensagem' i][contenteditable='true']",
        "div[aria-label*='mensaje' i][contenteditable='true']",
        "div[aria-label*='message' i][contenteditable='true']",
        "div.ql-editor",
        "textarea.msg-form__textarea",
        "textarea[name='message']",
        "textarea[placeholder*='mensagem' i]",
        "textarea[placeholder*='mensaje' i]",
        "textarea[placeholder*='message' i]",
        "p.msg-form__contenteditable",
        "[contenteditable='true']"
      ];
      for (const sel of selectors) {
        const elements = Array.from(document.querySelectorAll<HTMLElement>(sel));
        for (const el of elements) {
          try {
            el.click();
            el.focus();
            return true;
          } catch { /* continue */ }
        }
      }
      return false;
    }).catch(() => false);

    if (focusedViaDom) {
      return true;
    }

    // 3. Playwright locator check across candidates
    const loc = page.locator(`
      div.msg-form__contenteditable,
      div[role='textbox'].msg-form__message-texteditor,
      div[role='textbox'],
      form.msg-form [contenteditable='true'],
      form.msg-form textarea,
      textarea.msg-form__textarea,
      [contenteditable='true']
    `);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = loc.nth(i);
      if (await item.isVisible().catch(() => false)) {
        await item.click({ delay: 50 }).catch(() => {});
        await item.focus().catch(() => {});
        return true;
      }
    }

    await page.waitForTimeout(400);
  }
  return false;
}

async function openComposeByUrn(page: Page, messagingUrn: string): Promise<boolean> {
  try {
    const recipientId = messagingUrn.split(":").pop();
    const composeUrl = `https://www.linkedin.com/messaging/compose/?profileUrn=${encodeURIComponent(messagingUrn)}&recipient=${recipientId}`;
    console.log(`[message] Navigating to composeUrl: ${composeUrl}`);
    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const focused = await findAndFocusComposeBox(page, 15000);
    return focused;
  } catch (err) {
    console.warn("[message] openComposeByUrn failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function sendMessageViaTypeahead(
  page: Page,
  fullName: string,
  text: string,
  attachmentPath?: string | null,
  linkedinUrl?: string,
  resolvedProfileName?: string | null,
): Promise<void> {
  console.log(`[message] Opening new message compose thread for: "${fullName}" (profile: ${resolvedProfileName ?? "none"})`);
  
  // Strategy 1: Navigate directly to thread/new
  await page.goto("https://www.linkedin.com/messaging/thread/new/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // If redirected back to /messaging/, trigger the new message button
  const pageUrl = page.url();
  if (!pageUrl.includes("/thread/new")) {
    console.log("[message] Triggering new message compose button on /messaging/");
    const composeDirect = page.locator(`
      a[href*="/messaging/thread/new"]:visible,
      button.msg-conversations-container__compose-btn:visible,
      button[data-control-name="compose_message"]:visible,
      button:has(svg[data-test-icon*="compose"]):visible,
      button:has(li-icon[type*="compose"]):visible,
      button[aria-label*="escrever" i]:visible,
      button[aria-label*="criar" i]:visible,
      button[aria-label*="nova mensagem" i]:visible,
      button[aria-label*="novo mensaje" i]:visible,
      button[aria-label*="redactar" i]:visible,
      button[aria-label*="compose" i]:visible
    `).first();
    if ((await composeDirect.count().catch(() => 0)) > 0) {
      await composeDirect.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
    } else {
      await triggerNewMessageButton(page);
      await page.waitForTimeout(1500);
    }
  }

  // Strategy 2: Look for the recipient typeahead search field
  let searchFocused = false;
  const startSearch = Date.now();
  while (Date.now() - startSearch < 12000) {
    const searchField = page.locator(`
      input.msg-connections-typeahead__search-field,
      .msg-connections-typeahead input,
      form.msg-connections-typeahead input,
      .msg-compose input,
      input[role="combobox"][aria-label*="destinat" i],
      input[role="combobox"][placeholder*="nome" i],
      input[role="combobox"][placeholder*="nombre" i],
      input[role="combobox"][placeholder*="name" i],
      input[role="combobox"],
      input[placeholder*="nome" i]:not(.msg-search-form__search-field),
      input[placeholder*="nombre" i]:not(.msg-search-form__search-field),
      input[placeholder*="name" i]:not(.msg-search-form__search-field)
    `).first();

    if (await searchField.isVisible().catch(() => false)) {
      await searchField.click().catch(() => {});
      await searchField.focus().catch(() => {});
      searchFocused = true;
      break;
    }

    // Try DOM scan as fallback
    searchFocused = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      for (const input of inputs) {
        if (input.className.includes("msg-search-form")) continue; // Skip left sidebar search
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        if (rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
          const pl = (input.placeholder || "").toLowerCase();
          const aria = (input.getAttribute("aria-label") || "").toLowerCase();
          const cls = (input.className || "").toLowerCase();
          const role = (input.getAttribute("role") || "").toLowerCase();
          if (
            cls.includes("typeahead") ||
            role === "combobox" ||
            pl.includes("nome") || pl.includes("nombre") || pl.includes("name") || pl.includes("digite") || pl.includes("escreva") ||
            aria.includes("nome") || aria.includes("nombre") || aria.includes("name") || aria.includes("destinat") || aria.includes("recipient")
          ) {
            input.click();
            input.focus();
            return true;
          }
        }
      }
      return false;
    }).catch(() => false);

    if (searchFocused) break;

    // Retry triggering new message compose button if still not open
    await triggerNewMessageButton(page);
    await page.waitForTimeout(600);
  }

  // Build ordered list of candidate search queries to try
  const searchCandidates: string[] = [];
  if (resolvedProfileName && resolvedProfileName.trim().length >= 2) {
    searchCandidates.push(resolvedProfileName.trim());
  }
  if (fullName && fullName.trim().length >= 2 && !searchCandidates.includes(fullName.trim())) {
    searchCandidates.push(fullName.trim());
  }
  if (linkedinUrl) {
    const match = linkedinUrl.match(/\/in\/([^/?#]+)/i);
    if (match && match[1]) {
      const decodedVanity = decodeURIComponent(match[1])
        .replace(/[-_]/g, " ")
        .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, "")
        .trim();
      if (decodedVanity && decodedVanity.length >= 2 && !searchCandidates.includes(decodedVanity)) {
        searchCandidates.push(decodedVanity);
      }
    }
  }
  const firstName = (fullName || "").trim().split(/\s+/)[0];
  if (firstName && firstName.length >= 3 && !searchCandidates.includes(firstName)) {
    searchCandidates.push(firstName);
  }

  console.log(`[message] Search queries for typeahead: ${JSON.stringify(searchCandidates)}`);

  let clicked = false;
  if (searchFocused) {
    for (let cIdx = 0; cIdx < searchCandidates.length; cIdx++) {
      const term = searchCandidates[cIdx];
      console.log(`[message] Trying typeahead search with term: "${term}"`);

      // Clear input before typing next term
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(200);

      await page.keyboard.type(term, { delay: 50 });
      await page.waitForTimeout(2500);

      const resultRows = page.locator(`
        div[class*="msg-connections-typeahead__search-result-row"],
        li[class*="msg-connections-typeahead__result-item"],
        .msg-connections-typeahead__search-results li,
        [role="option"]
      `);

      const optCount = await resultRows.count().catch(() => 0);
      console.log(`[message] Results returned for "${term}": ${optCount}`);

      for (let i = 0; i < optCount; i++) {
        const opt = resultRows.nth(i);
        if (await opt.isVisible().catch(() => false)) {
          const textContent = (await opt.innerText().catch(() => "")).trim();
          if (
            resultNameMatches(textContent, term) ||
            resultNameMatches(textContent, fullName) ||
            (resolvedProfileName && resultNameMatches(textContent, resolvedProfileName))
          ) {
            console.log(`[message] Matching recipient found in results: "${textContent}"`);
            await opt.click({ delay: 100 });
            clicked = true;
            break;
          }
        }
      }

      if (clicked) break;

      // If only 1 result returned and we searched by specific profile name or vanity, accept it
      if (!clicked && optCount === 1) {
        const single = resultRows.first();
        if (await single.isVisible().catch(() => false)) {
          console.log("[message] Selecting sole result returned by typeahead");
          await single.click({ delay: 100 });
          clicked = true;
          break;
        }
      }
    }
    await page.waitForTimeout(1500);
  }

  if (!searchFocused || !clicked) {
    throw new Error(`Could not find or select recipient "${fullName}" in LinkedIn messaging — aborting to prevent false delivery`);
  }

  await sendFromComposeBox(page, text, attachmentPath);
}

async function searchExistingConversation(page: Page, fullName: string): Promise<boolean> {
  try {
    const searchInput = page.locator(`
      input.msg-search-form__search-field,
      input[placeholder*="Pesquisar" i],
      input[placeholder*="Buscar" i],
      input[placeholder*="Search" i],
      input[aria-label*="Pesquisar" i],
      input[aria-label*="Buscar" i],
      input[aria-label*="Search" i]
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
    s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const target = normalize(fullName);
  const result = normalize(resultText);
  if (!target || !result) return false;
  if (result.includes(target)) return true;

  // Check word by word or first name match (e.g. "More Fernandez" matches "More")
  const targetWords = target.split(" ").filter(w => w.length > 1);
  if (targetWords.length > 0 && targetWords.every(w => result.includes(w))) {
    return true;
  }
  const firstTarget = targetWords[0];
  if (firstTarget && firstTarget.length >= 3 && result.includes(firstTarget)) {
    return true;
  }
  return false;
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

  // 2. Focus and enter text message into compose area
  if (text?.trim()) {
    console.log("[message] Focusing compose box for text entry");
    const focused = await findAndFocusComposeBox(page, 8000);
    if (!focused) {
      throw new Error("LinkedIn compose box not found or not focused — aborting to prevent false delivery");
    }

    // Try clipboard paste first
    try {
      await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      await page.waitForTimeout(200);
      await page.keyboard.press("Control+V");
      await page.waitForTimeout(300);
    } catch {
      /* continue to verification */
    }

    // Check if text was actually inserted into the active contenteditable
    const hasText = await page.evaluate(() => {
      const active = document.activeElement;
      return active ? (active.textContent || "").trim().length > 0 : false;
    }).catch(() => false);

    if (!hasText) {
      console.log("[message] Direct typing message text into compose box");
      await page.keyboard.type(text, { delay: 10 });
      await page.waitForTimeout(400);
    }

    // Trigger input and change events so LinkedIn's React/Ember app enables the Send button
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active) {
        active.dispatchEvent(new Event("input", { bubbles: true }));
        active.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const allBoxes = document.querySelectorAll("div.msg-form__contenteditable, [contenteditable='true']");
      for (const box of Array.from(allBoxes)) {
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }).catch(() => {});
    await page.waitForTimeout(600);
  }

  // 3. Multi-strategy send dispatch
  console.log("[message] Dispatching send action");
  let sentViaDom = false;

  // Strategy A: DOM submit on form or send button
  sentViaDom = await page.evaluate(() => {
    // 1. Look for submit button inside active message form
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>("form.msg-form, .msg-overlay-conversation-bubble form, .msg-thread form, form"));
    for (const form of forms) {
      const btn = form.querySelector<HTMLButtonElement>(
        'button[type="submit"], button.msg-form__send-button, button.msg-form__send-btn, footer button.artdeco-button--primary, button[data-control-name="send_message"]'
      );
      if (btn) {
        btn.removeAttribute("disabled");
        btn.disabled = false;
        btn.click();
        return true;
      }
    }

    // 2. Scan all buttons on page for send intent
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    for (const b of buttons) {
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      const text = (b.innerText || "").trim().toLowerCase();
      const type = b.getAttribute("type");
      const hasIcon = !!b.querySelector('svg[data-test-icon*="send"], li-icon[type*="send"]');
      if (
        (type === "submit" && (b.className.includes("msg") || b.closest("footer, form"))) ||
        aria.includes("enviar") ||
        aria.includes("send") ||
        text === "enviar" ||
        text === "send" ||
        hasIcon
      ) {
        const rect = b.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          b.removeAttribute("disabled");
          b.disabled = false;
          b.click();
          return true;
        }
      }
    }
    return false;
  }).catch(() => false);

  if (sentViaDom) {
    console.log("[message] Send button clicked via DOM successfully");
  } else {
    // Strategy B: Playwright locator fallback
    const sendLocator = page.locator(`
      form.msg-form button[type='submit'],
      button.msg-form__send-button,
      button.msg-form__send-btn,
      footer button.artdeco-button--primary,
      button:has(svg[data-test-icon*='send']),
      button:has-text("Enviar"),
      button:has-text("Send")
    `);

    const count = await sendLocator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const b = sendLocator.nth(i);
      if (await b.isVisible().catch(() => false)) {
        if (await b.isDisabled().catch(() => false)) {
          await page.keyboard.press("Space");
          await page.keyboard.press("Backspace");
          await page.waitForTimeout(300);
        }
        await b.click({ delay: 50 }).catch(() => {});
        console.log("[message] Send button clicked via Playwright locator");
        break;
      }
    }
  }

  // Strategy C: Keyboard shortcuts — Control+Enter is the universal shortcut in LinkedIn to send
  console.log("[message] Sending keyboard send shortcut (Control+Enter)");
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
  console.log("[message] Send sequence completed");
}
