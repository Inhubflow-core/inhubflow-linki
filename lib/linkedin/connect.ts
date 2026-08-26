import type { Locator, Page, Response } from "playwright";

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}

const MODAL_SELECTOR = '[role="dialog"]:visible, .artdeco-modal:visible, [data-test-modal]:visible';
const MENU_SELECTOR = '[role="menu"]:visible, .artdeco-dropdown__content:visible, .artdeco-dropdown__menu:visible';
const TOAST_SELECTOR = [
  '[role="alert"]:visible',
  '[data-test-artdeco-toast-item-type]:visible',
  '.artdeco-toast-item:visible',
  '[class*="toast"]:visible',
].join(",");

const CONNECT_LABEL_RE = /^(?:conectar|connect|se connecter|vernetzen|convidar|invitar|invite)$/i;
const MORE_LABEL_RE = /^(?:mais|mais ações|mais a[cç][õo]es|mais opções|mais op[cç][õo]es|más|más acciones|more|more actions|more options|actions|options)$/i;
const PENDING_LABEL_RE = /(?:convite pendente|invitation pending|invitación pendiente|pendente|pending|pendiente|aguardando|invitation sent|convite enviado|invitación enviada|cancelar convite|retirar convite|withdraw invitation|cancelar invitación|retirar invitación)/i;
const SENT_LABEL_RE = /(?:convite enviado|invitation sent|invitación enviada|solicitação enviada|pedido enviado|request sent|connection request sent|conexão enviada)/i;
const LIMIT_RE = /(?:weekly connection limit|weekly limit|limite semanal|limite de convites|atingiu o limite|reached the limit)/i;
const EMAIL_PROMPT_RE = /(?:digite|insira|informe|enter|provide).*e-?mail|e-?mail.*(?:para conectar|to connect|connection)/i;
const ADD_NOTE_RE = /^(?:adicionar uma nota|adicionar nota|add a note|add note|adicionar mensagem|add message)$/i;
const SEND_WITHOUT_NOTE_RE = /^(?:enviar sem nota|enviar sem uma nota|enviar agora|enviar convite|enviar convite agora|send without a note|send without note|send now|send invitation|send invitation without a note|enviar sin nota|enviar sin una nota)$/i;
const GENERIC_SEND_RE = /^(?:enviar|send)$/i;

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/ /g, " ")
    .replace(/[+＋]/g, " ")
    .replace(/[.…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function matchesLabel(value: string | null | undefined, expression: RegExp): boolean {
  return expression.test(normalizeLabel(value));
}

async function visibleAction(
  scope: Locator,
  matcher: (text: string, aria: string, title: string, className: string) => boolean,
  selector = 'button, a, [role="button"], [role="menuitem"], .artdeco-dropdown__item'
): Promise<Locator | null> {
  const candidates = scope.locator(selector);
  const count = await candidates.count().catch(() => 0);

  for (let index = 0; index < count; index++) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;

    const [text, aria, title, className] = await Promise.all([
      candidate.innerText().catch(() => ""),
      candidate.getAttribute("aria-label").then((value) => value ?? "").catch(() => ""),
      candidate.getAttribute("title").then((value) => value ?? "").catch(() => ""),
      candidate.getAttribute("class").then((value) => value ?? "").catch(() => ""),
    ]);
    if (matcher(text, aria, title, className)) return candidate;
  }

  return null;
}

async function visibleCustomInvite(scope: Locator): Promise<Locator | null> {
  const links = scope.locator('a[href*="custom-invite"]');
  const count = await links.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const link = links.nth(index);
    if (await link.isVisible().catch(() => false)) return link;
  }
  return null;
}

function isConnectAction(text: string, aria: string, title: string): boolean {
  if (matchesLabel(text, CONNECT_LABEL_RE)) return true;
  return [aria, title].some((value) => {
    const label = normalizeLabel(value);
    return CONNECT_LABEL_RE.test(label) || /(?:^|\s)(?:conectar|connect|convidar|invitar|invite)(?:\s|$)/i.test(label);
  });
}

function isMoreTrigger(text: string, aria: string, title: string, className: string): boolean {
  if ([text, aria, title].some((value) => {
    const label = normalizeLabel(value);
    return MORE_LABEL_RE.test(label) || /^(?:mais a[cç][õo]es|mais op[cç][õo]es|más acciones|more actions|more options)(?:\s+(?:para|de|for|on)\b.*)?$/i.test(label);
  })) return true;
  return /artdeco-dropdown__trigger|profile-actions__overflow/i.test(className);
}

function isPendingAction(text: string, aria: string, title: string): boolean {
  return [text, aria, title].some((value) => PENDING_LABEL_RE.test(normalizeLabel(value)));
}

async function profileActionScope(page: Page): Promise<Locator> {
  const topCard = page.locator("main section:has(h1):visible").first();
  if ((await topCard.count().catch(() => 0)) > 0) return topCard;
  return page.locator("main").first();
}

async function hasPendingProfileAction(scope: Locator): Promise<boolean> {
  const action = await visibleAction(
    scope,
    (text, aria, title) => isPendingAction(text, aria, title),
    'button, a, [role="button"]'
  );
  return action !== null;
}

async function visibleToastMatching(page: Page, expression: RegExp): Promise<string | null> {
  const toasts = page.locator(TOAST_SELECTOR);
  const count = await toasts.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const toast = toasts.nth(index);
    if (!(await toast.isVisible().catch(() => false))) continue;
    const text = await toast.innerText().catch(() => "");
    if (expression.test(normalizeLabel(text))) return text.trim();
  }
  return null;
}

async function visibleWeeklyLimit(page: Page): Promise<string | null> {
  const surfaces = page.locator(`
    div[class*="ip-fuse-limit-alert__warning"]:visible,
    ${MODAL_SELECTOR},
    ${TOAST_SELECTOR}
  `);
  const count = await surfaces.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const text = await surfaces.nth(index).innerText().catch(() => "");
    if (LIMIT_RE.test(normalizeLabel(text))) return text.trim() || "Weekly connection limit reached";
  }
  return null;
}

async function visibleError(page: Page): Promise<string | null> {
  const toast = page.locator(TOAST_SELECTOR);
  const count = await toast.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const item = toast.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = await item.innerText().catch(() => "");
    if (!text.trim()) continue;
    if (SENT_LABEL_RE.test(normalizeLabel(text))) continue;
    if (LIMIT_RE.test(normalizeLabel(text))) {
      throw new WeeklyLimitError("Weekly connection limit reached");
    }
    const type = await item.getAttribute("data-test-artdeco-toast-item-type").catch(() => "");
    if (type?.toLowerCase() === "error") return text.trim();
  }
  return null;
}

async function isRendered(locator: Locator): Promise<boolean> {
  if (!(await locator.isVisible().catch(() => false))) return false;
  const box = await locator.boundingBox().catch(() => null);
  return Boolean(box && box.width > 0 && box.height > 0);
}

async function findInvitationModal(page: Page): Promise<Locator | null> {
  const modals = page.locator(MODAL_SELECTOR);
  const count = await modals.count().catch(() => 0);

  for (let index = 0; index < count; index++) {
    const modal = modals.nth(index);
    if (!(await isRendered(modal))) continue;
    const text = await modal.innerText().catch(() => "");
    const sendButton = await visibleAction(
      modal,
      (buttonText, aria, title) =>
        SEND_WITHOUT_NOTE_RE.test(normalizeLabel(buttonText)) ||
        SEND_WITHOUT_NOTE_RE.test(normalizeLabel(aria)) ||
        SEND_WITHOUT_NOTE_RE.test(normalizeLabel(title)),
      'button, [role="button"]'
    );
    if (EMAIL_PROMPT_RE.test(normalizeLabel(text)) || /(?:adicionar|add).*nota|sem nota|without.*note|enviar agora|send now|convite|invitation/i.test(normalizeLabel(text)) || sendButton) {
      return modal;
    }
  }

  return null;
}

async function waitForInvitationModal(page: Page, timeoutMs = 15000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const modal = await findInvitationModal(page);
    if (modal) {
      // LinkedIn animates the dialog and its contents separately. Require a
      // rendered box and a usable action before treating it as ready.
      const sendButton = await findSendButton(modal);
      if (sendButton && (await isRendered(sendButton))) return modal;
      const text = normalizeLabel(await modal.innerText().catch(() => ""));
      const emailInput = modal.locator('input[type="email"]:visible, input#email:visible');
      if (EMAIL_PROMPT_RE.test(text) || (await emailInput.count().catch(() => 0)) > 0) return modal;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function findSendButton(modal: Locator): Promise<Locator | null> {
  const known = await visibleAction(
    modal,
    (text, aria, title) => [text, aria, title].some((value) => SEND_WITHOUT_NOTE_RE.test(normalizeLabel(value))),
    'button, [role="button"]'
  );
  if (known) return known;

  // Some LinkedIn locales expose only "Enviar"/"Send" on the final action.
  // This fallback is exact and explicitly excludes the note action.
  return visibleAction(
    modal,
    (text, aria, title) => {
      const labels = [text, aria, title].map(normalizeLabel);
      return labels.some((label) => GENERIC_SEND_RE.test(label) && !ADD_NOTE_RE.test(label));
    },
    'button, [role="button"]'
  );
}

async function waitForEnabled(button: Locator, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) return true;
    await button.page().waitForTimeout(200);
  }
  return false;
}

function customInviteUrl(href: string, currentUrl: string): string {
  const url = new URL(href, currentUrl);
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) {
    throw new Error(`Refusing to navigate custom invite URL outside LinkedIn: ${url.hostname}`);
  }
  return url.toString();
}

async function activateConnectAction(page: Page, action: Locator): Promise<void> {
  const href = await action.getAttribute("href").catch(() => null);
  const nestedHref = href || await action.locator('a[href*="custom-invite"]').getAttribute("href").catch(() => null);

  if (nestedHref?.includes("custom-invite")) {
    const inviteUrl = customInviteUrl(nestedHref, page.url());
    // Clicking preserves LinkedIn's SPA behavior and its analytics. The
    // navigation fallback handles DOM variants where the anchor has no click
    // handler and the preload route must be opened directly.
    await action.click({ force: true, noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(1200);
    if (!(await findInvitationModal(page))) {
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    return;
  }

  await action.click({ force: true });
  await page.waitForTimeout(1000);
}

async function findConnectInOpenMenu(page: Page): Promise<Locator | null> {
  const customLink = await visibleCustomInvite(page.locator("body"));
  if (customLink) return customLink;

  const menus = page.locator(MENU_SELECTOR);
  const menuCount = await menus.count().catch(() => 0);
  for (let index = 0; index < menuCount; index++) {
    const option = await visibleAction(
      menus.nth(index),
      (text, aria, title) => isConnectAction(text, aria, title),
      'a, button, [role="menuitem"], [role="button"], .artdeco-dropdown__item'
    );
    if (option) return option;
  }

  // A few LinkedIn builds omit role="menu" but retain menuitem/Artdeco item
  // classes. These are safe to inspect only after a trigger has been clicked.
  return visibleAction(
    page.locator("body"),
    (text, aria, title) => isConnectAction(text, aria, title),
    '[role="menuitem"], .artdeco-dropdown__item, [data-control-name*="connect" i]'
  );
}

async function findPendingInOpenMenu(page: Page): Promise<Locator | null> {
  const menus = page.locator(MENU_SELECTOR);
  const menuCount = await menus.count().catch(() => 0);
  for (let index = 0; index < menuCount; index++) {
    const pending = await visibleAction(
      menus.nth(index),
      (text, aria, title) => isPendingAction(text, aria, title),
      'a, button, [role="menuitem"], [role="button"], .artdeco-dropdown__item'
    );
    if (pending) return pending;
  }

  return visibleAction(
    page.locator("body"),
    (text, aria, title) => isPendingAction(text, aria, title),
    '[role="menuitem"], .artdeco-dropdown__item'
  );
}

async function waitForOpenMenuAction(
  page: Page,
  timeoutMs = 2500
): Promise<{ connect: Locator | null; pending: Locator | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await findPendingInOpenMenu(page);
    if (pending) return { connect: null, pending };
    const connect = await findConnectInOpenMenu(page);
    if (connect) return { connect, pending: null };
    await page.waitForTimeout(150);
  }
  return { connect: null, pending: null };
}

async function clickConnectFromMoreMenu(page: Page, scope: Locator): Promise<Locator | null> {
  const triggerCandidates = scope.locator(`
    button[aria-haspopup="menu"],
    [role="button"][aria-haspopup="menu"],
    button.artdeco-dropdown__trigger,
    [role="button"].artdeco-dropdown__trigger,
    button[aria-label],
    button[title],
    [role="button"][aria-label],
    [role="button"][title]
  `);
  const count = await triggerCandidates.count().catch(() => 0);

  for (let index = 0; index < count; index++) {
    const trigger = triggerCandidates.nth(index);
    if (!(await trigger.isVisible().catch(() => false))) continue;
    const [text, aria, title, className] = await Promise.all([
      trigger.innerText().catch(() => ""),
      trigger.getAttribute("aria-label").then((value) => value ?? "").catch(() => ""),
      trigger.getAttribute("title").then((value) => value ?? "").catch(() => ""),
      trigger.getAttribute("class").then((value) => value ?? "").catch(() => ""),
    ]);
    if (!isMoreTrigger(text, aria ?? "", title ?? "", className ?? "")) continue;

    await trigger.click({ force: true }).catch(() => {});
    const menuAction = await waitForOpenMenuAction(page);
    if (menuAction.pending) {
      throw new PendingInviteError("Invitation already pending (found in More/Mais menu)");
    }
    if (menuAction.connect) return menuAction.connect;

    // Do not let a failed candidate leave a different popover open while the
    // next DOM variant is tried.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }

  return null;
}

async function hasPendingInMoreMenu(page: Page, scope: Locator): Promise<boolean> {
  const triggers = scope.locator(`
    button[aria-haspopup="menu"],
    [role="button"][aria-haspopup="menu"],
    button.artdeco-dropdown__trigger,
    [role="button"].artdeco-dropdown__trigger,
    button[aria-label],
    button[title],
    [role="button"][aria-label],
    [role="button"][title]
  `);
  const count = await triggers.count().catch(() => 0);

  for (let index = 0; index < count; index++) {
    const trigger = triggers.nth(index);
    if (!(await trigger.isVisible().catch(() => false))) continue;
    const [text, aria, title, className] = await Promise.all([
      trigger.innerText().catch(() => ""),
      trigger.getAttribute("aria-label").then((value) => value ?? "").catch(() => ""),
      trigger.getAttribute("title").then((value) => value ?? "").catch(() => ""),
      trigger.getAttribute("class").then((value) => value ?? "").catch(() => ""),
    ]);
    if (!isMoreTrigger(text, aria, title, className)) continue;

    await trigger.click({ force: true }).catch(() => {});
    const menuAction = await waitForOpenMenuAction(page);
    if (menuAction.pending) return true;
    await page.keyboard.press("Escape").catch(() => {});
  }

  return false;
}

async function confirmOnProfile(page: Page, linkedinUrl: string): Promise<boolean> {
  const scope = await profileActionScope(page);
  if (await hasPendingProfileAction(scope) || await hasPendingInMoreMenu(page, scope)) return true;

  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
  const refreshedScope = await profileActionScope(page);
  return await hasPendingProfileAction(refreshedScope) || await hasPendingInMoreMenu(page, refreshedScope);
}

async function confirmConnectionRequest(
  page: Page,
  linkedinUrl: string,
  responseSeen: () => boolean
): Promise<void> {
  const deadline = Date.now() + 15000;
  let modalClosedAt: number | null = null;
  let profileChecked = false;

  while (Date.now() < deadline) {
    const limit = await visibleWeeklyLimit(page);
    if (limit) throw new WeeklyLimitError(limit);

    const error = await visibleError(page);
    if (error) throw new Error(`Connection error: ${error}`);

    if (await visibleToastMatching(page, SENT_LABEL_RE)) return;
    if (await findInvitationModal(page)) {
      modalClosedAt = null;
    } else if (modalClosedAt === null) {
      modalClosedAt = Date.now();
    }

    if (modalClosedAt !== null && responseSeen()) return;

    // Give the invitation request time to finish before reloading the profile;
    // navigating immediately when the modal closes can cancel an in-flight POST.
    if (modalClosedAt !== null && !profileChecked && Date.now() - modalClosedAt >= 2500) {
      profileChecked = true;
      if (await confirmOnProfile(page, linkedinUrl)) return;
    }
    await page.waitForTimeout(300);
  }

  const limit = await visibleWeeklyLimit(page);
  if (limit) throw new WeeklyLimitError(limit);
  const error = await visibleError(page);
  if (error) throw new Error(`Connection error: ${error}`);
  throw new Error("LinkedIn did not confirm that the connection request was sent");
}

/**
 * Sends a LinkedIn connection request without a note.
 * Handles all UI languages (Portuguese, Spanish, English, etc.) and both
 * direct Connect actions and Creator-mode More/Mais dropdown menus.
 */
export async function sendConnectionRequest(page: Page, linkedinUrl: string): Promise<void> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(3000 + Math.random() * 1500);

  const topCard = await profileActionScope(page);
  const pageText = await topCard.innerText().catch(() => "");
  const isExplicit2ndOr3rd = /\b[23][ºªndrdth°\.]/i.test(pageText) || /•\s*[23]º/i.test(pageText);
  const isExplicit1st = ( /\b1[ºªster°\.]/i.test(pageText) || /•\s*1º/i.test(pageText) ) && !isExplicit2ndOr3rd;
  if (isExplicit1st) throw new AlreadyConnectedError("Already connected (1st degree)");
  if (await hasPendingProfileAction(topCard)) throw new PendingInviteError("Invitation already pending");

  let connectAction = await visibleCustomInvite(topCard);
  if (!connectAction) {
    connectAction = await visibleAction(
      topCard,
      (text, aria, title) => isConnectAction(text, aria, title),
      'button, a, [role="button"]'
    );
  }

  if (connectAction) {
    await activateConnectAction(page, connectAction);
  } else {
    const menuConnect = await clickConnectFromMoreMenu(page, topCard);
    if (!menuConnect) {
      throw new Error("Could not find the LinkedIn More/Mais menu or its Connect/Conectar option");
    }
    await activateConnectAction(page, menuConnect);
  }

  const modal = await waitForInvitationModal(page);
  if (!modal) {
    const error = await visibleError(page);
    if (error) throw new Error(`Connection error: ${error}`);
    const limit = await visibleWeeklyLimit(page);
    if (limit || LIMIT_RE.test(normalizeLabel(await page.locator("body").innerText().catch(() => "")))) {
      throw new WeeklyLimitError(limit || "Weekly connection limit reached");
    }
    throw new Error("LinkedIn did not open the connection invitation modal");
  }

  const modalText = await modal.innerText().catch(() => "");
  const emailPrompt = modal.locator('input[type="email"]:visible, input#email:visible');
  if ((await emailPrompt.count().catch(() => 0)) > 0 || EMAIL_PROMPT_RE.test(normalizeLabel(modalText))) {
    const closeButton = await visibleAction(
      modal,
      (text, aria, title) => /dismiss|fechar|cerrar|close/i.test(`${text} ${aria} ${title}`),
      'button, [role="button"]'
    );
    if (closeButton) await closeButton.click({ force: true }).catch(() => {});
    throw new Error("LinkedIn requires an email address to connect with this target");
  }

  const sendButton = await findSendButton(modal);
  if (!sendButton) {
    throw new Error("LinkedIn connection modal opened, but no 'Send without a note' button was found");
  }
  if (!(await waitForEnabled(sendButton))) {
    throw new Error("LinkedIn connection send button remained disabled");
  }

  let responseSeen = false;
  const responseHandler = (response: Response) => {
    try {
      const request = response.request();
      if (
        request.method() === "POST" &&
        response.status() >= 200 &&
        response.status() < 300 &&
        /linkedin\.com\/voyager\/api\/.*(?:relationship|invitation|connection)/i.test(response.url())
      ) {
        responseSeen = true;
      }
    } catch {
      // ignore
    }
  };
  page.on("response", responseHandler);

  try {
    try {
      await sendButton.click({ force: true, timeout: 10000 });
    } catch (error) {
      throw new Error(`Could not click LinkedIn's send-without-note button: ${error instanceof Error ? error.message : String(error)}`);
    }
    await confirmConnectionRequest(page, linkedinUrl, () => responseSeen);
  } finally {
    page.off("response", responseHandler);
  }
}
