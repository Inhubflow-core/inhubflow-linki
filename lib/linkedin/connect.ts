import type { Locator, Page } from "playwright";
import { isLinkedInAuthenticationWall, LinkedInAuthenticationError } from "./auth-wall";

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}
export class ConnectionPreSubmitError extends Error {}
export class UncertainConnectionOutcomeError extends Error {}

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
const PENDING_LABEL_RE = /^(?:pendente|pending|pendiente|convite pendente|invitation pending|invitación pendiente|aguardando confirma[cç][ãa]o|convite enviado|invitation sent|invitación enviada|cancelar convite|retirar convite|cancelar solicitação|withdraw invitation)$/i;
const SENT_LABEL_RE = /(?:convite enviado|invitation sent|invitación enviada|solicitação enviada|pedido enviado|request sent|connection request sent|conexão enviada)/i;
const NEGATED_SENT_RE = /(?:não (?:foi )?enviado|nao (?:foi )?enviado|não conseguimos enviar|nao conseguimos enviar|not sent|was not sent|wasn't sent|could not send|couldn't send|no (?:se )?(?:envió|envio)|no pudimos enviar)/i;
const ERROR_LABEL_RE = /(?:algo deu errado|ocorreu um erro|não foi possível|nao foi possivel|tente novamente|could not|couldn't|unable to|something went wrong|try again|no se pudo|ocurrió un error|inténtalo de nuevo)/i;
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
  return [text, aria, title].some((value) => {
    const label = normalizeLabel(value);
    return (
      CONNECT_LABEL_RE.test(label) ||
      /(?:^|\s)(?:conectar|connect|convidar|invitar|invite|se connecter|conectar-se)(?:\s|$)/i.test(label) ||
      label.includes("conectar") ||
      label.includes("connect") ||
      label.includes("convidar")
    );
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

async function visibleSentToast(page: Page): Promise<string | null> {
  const toasts = page.locator(TOAST_SELECTOR);
  const count = await toasts.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const toast = toasts.nth(index);
    if (!(await toast.isVisible().catch(() => false))) continue;
    const text = await toast.innerText().catch(() => "");
    const label = normalizeLabel(text);
    if (SENT_LABEL_RE.test(label) && !NEGATED_SENT_RE.test(label) && !ERROR_LABEL_RE.test(label)) {
      return text.trim();
    }
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
    const label = normalizeLabel(text);
    if (LIMIT_RE.test(label)) {
      throw new WeeklyLimitError("Weekly connection limit reached");
    }
    const type = await item.getAttribute("data-test-artdeco-toast-item-type").catch(() => "");
    if (type?.toLowerCase() === "error" || ERROR_LABEL_RE.test(label) || NEGATED_SENT_RE.test(label)) {
      return text.trim();
    }
    if (SENT_LABEL_RE.test(label)) continue;
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

function profileVanityName(profileUrl: string): string | null {
  try {
    const match = new URL(profileUrl).pathname.match(/^\/in\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]).toLocaleLowerCase("en-US") : null;
  } catch {
    return null;
  }
}

function resolveCustomInvite(
  href: string,
  currentUrl: string,
  expectedProfileUrl: string
): { url: string; clickCandidate: boolean } {
  const candidateUrl = new URL(href, currentUrl);
  if (!/(^|\.)linkedin\.com$/i.test(candidateUrl.hostname)) {
    throw new Error(`Refusing to navigate custom invite URL outside LinkedIn: ${candidateUrl.hostname}`);
  }

  const expectedVanity = profileVanityName(expectedProfileUrl);
  const inviteVanity = candidateUrl.searchParams.get("vanityName")?.toLocaleLowerCase("en-US") ?? null;
  if (expectedVanity && inviteVanity && expectedVanity !== inviteVanity) {
    const expectedUrl = new URL("/preload/custom-invite/", candidateUrl.origin);
    expectedUrl.searchParams.set("vanityName", expectedVanity);
    return { url: expectedUrl.toString(), clickCandidate: false };
  }
  return { url: candidateUrl.toString(), clickCandidate: true };
}

async function activateConnectAction(
  page: Page,
  action: Locator,
  expectedProfileUrl: string
): Promise<void> {
  const href = await action.getAttribute("href").catch(() => null);
  const nestedHref = href || await action.locator('a[href*="custom-invite"]').getAttribute("href").catch(() => null);

  if (nestedHref?.includes("custom-invite")) {
    const invite = resolveCustomInvite(nestedHref, page.url(), expectedProfileUrl);
    // Click only when the menu link belongs to the expected profile. LinkedIn
    // pages can expose custom-invite links for recommendation cards; when that
    // happens, navigate to the deterministic invite URL for the target instead.
    if (invite.clickCandidate) {
      await action.click({ force: true, noWaitAfter: true }).catch(() => {});
      await page.waitForTimeout(1200);
      if (await findInvitationModal(page)) return;
    }
    await page.goto(invite.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return;
  }

  await action.click({ force: true });
  await page.waitForTimeout(1000);
}

async function findConnectInOpenMenu(page: Page): Promise<Locator | null> {
  const customLink = page.locator('a[href*="custom-invite"]:visible, [role="menuitem"]:has(a[href*="custom-invite"]):visible').first();
  if (await customLink.isVisible().catch(() => false)) {
    return customLink;
  }

  const directCandidates = page.locator(`
    .artdeco-dropdown__content--is-open a,
    .artdeco-dropdown__content--is-open button,
    .artdeco-dropdown__content--is-open [role="button"],
    .artdeco-dropdown__content--is-open .artdeco-dropdown__item,
    .artdeco-dropdown__content--is-open [role="menuitem"],
    .artdeco-dropdown__content--is-open div,
    .artdeco-dropdown__content--is-open span,
    [role="menu"]:visible a,
    [role="menu"]:visible [role="menuitem"],
    [role="menu"]:visible .artdeco-dropdown__item,
    [role="menu"]:visible [role="button"],
    [role="menu"]:visible button,
    [role="menu"]:visible span,
    .artdeco-dropdown__content:visible a,
    .artdeco-dropdown__content:visible [role="button"],
    .artdeco-dropdown__content:visible button,
    .artdeco-dropdown__content:visible .artdeco-dropdown__item,
    .artdeco-dropdown__content:visible [role="menuitem"],
    .artdeco-dropdown__content:visible span,
    .artdeco-dropdown__item:visible
  `);

  const count = await directCandidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const candidate = directCandidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const [text, aria, title] = await Promise.all([
      candidate.innerText().catch(() => ""),
      candidate.getAttribute("aria-label").then((val) => val ?? "").catch(() => ""),
      candidate.getAttribute("title").then((val) => val ?? "").catch(() => ""),
    ]);
    if (isConnectAction(text, aria, title)) {
      return candidate;
    }
  }

  const menus = page.locator(MENU_SELECTOR);
  const menuCount = await menus.count().catch(() => 0);
  for (let index = 0; index < menuCount; index++) {
    const menu = menus.nth(index);
    const customLink = await visibleCustomInvite(menu);
    if (customLink) return customLink;

    const option = await visibleAction(
      menu,
      (text, aria, title) => isConnectAction(text, aria, title),
      'a, button, [role="menuitem"], [role="button"], .artdeco-dropdown__item, span, div'
    );
    if (option) return option;
  }

  return visibleAction(
    page.locator(MENU_SELECTOR),
    (text, aria, title) => isConnectAction(text, aria, title),
    'a, [role="menuitem"]:visible, .artdeco-dropdown__item:visible, .artdeco-dropdown__content *:visible'
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

  return null;
}

async function waitForOpenMenuAction(
  page: Page,
  timeoutMs = 3000
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
  // 1. Prioritize real 3-dots / More / Más buttons on the profile header
  const priorityMoreSelectors = [
    'main section:has(h1) button[aria-label*="más" i]',
    'main section:has(h1) button[aria-label*="mais" i]',
    'main section:has(h1) button[aria-label*="more" i]',
    'main section:has(h1) button[aria-label*="acciones" i]',
    'main section:has(h1) button[aria-label*="actions" i]',
    'main section:has(h1) button[aria-label*="opções" i]',
    'main section:has(h1) button[aria-label*="opciones" i]',
    'main section:has(h1) button:has(svg[data-test-icon*="overflow"])',
    'main section:has(h1) button:has(li-icon[type*="overflow"])',
    'main section:has(h1) button.artdeco-dropdown__trigger',
    '.pvs-profile-actions button.artdeco-dropdown__trigger',
    '.pvs-profile-actions button[aria-label*="más" i]',
    '.pvs-profile-actions button[aria-label*="more" i]',
    '.pvs-profile-actions button:has(svg[data-test-icon*="overflow"])',
    'main button[aria-label*="más acciones" i]',
    'main button[aria-label*="más opciones" i]',
    'main button[aria-label*="more actions" i]',
    'main button[aria-label*="mais ações" i]',
    'main button:has(svg[data-test-icon*="overflow"])',
    'main button:has(li-icon[type*="overflow"])',
    'main button.artdeco-dropdown__trigger:has-text("Más")',
    'main button.artdeco-dropdown__trigger:has-text("Mais")',
    'main button.artdeco-dropdown__trigger:has-text("More")',
    'button[aria-label*="mais ações" i]',
    'button[aria-label*="más acciones" i]',
    'button[aria-label*="more actions" i]',
    'button[aria-label*="mais opções" i]',
    'button[aria-label*="más opciones" i]',
    'button[aria-label*="mais" i]',
    'button[aria-label*="más" i]',
    'button[aria-label*="more" i]',
    'button:has(svg[data-test-icon*="overflow"])',
    'button:has(li-icon[type*="overflow"])',
    'button.artdeco-dropdown__trigger',
  ];

  for (const selector of priorityMoreSelectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
      const menuAction = await waitForOpenMenuAction(page, 3500);
      if (menuAction.pending) {
        throw new PendingInviteError("Invitation already pending (found in More/Mais menu)");
      }
      if (menuAction.connect) return menuAction.connect;
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    }
  }

  // 2. Fallback: search triggerCandidates inside scope
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

    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const menuAction = await waitForOpenMenuAction(page, 3000);
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

async function profileShowsPending(page: Page): Promise<boolean> {
  const scope = await profileActionScope(page);
  return await hasPendingProfileAction(scope) || await hasPendingInMoreMenu(page, scope);
}

async function confirmOnProfile(page: Page, linkedinUrl: string): Promise<boolean> {
  try {
    await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (error) {
    const url = page.url();
    if (isLinkedInAuthenticationWall(url)) {
      throw new LinkedInAuthenticationError(`LinkedIn authentication wall after connection submission (${url})`, true);
    }
    throw error;
  }
  await page.waitForTimeout(2000);
  const url = page.url();
  if (isLinkedInAuthenticationWall(url)) {
    throw new LinkedInAuthenticationError(`LinkedIn authentication wall after connection submission (${url})`, true);
  }
  return profileShowsPending(page);
}

async function confirmConnectionRequest(page: Page, linkedinUrl: string): Promise<void> {
  const modalDeadline = Date.now() + 15000;
  let modalClosedAt: number | null = null;
  let sawSentToast = false;

  while (Date.now() < modalDeadline) {
    const limit = await visibleWeeklyLimit(page);
    if (limit) throw new WeeklyLimitError(limit);

    const error = await visibleError(page);
    if (error) throw new Error(`Connection error: ${error}`);

    if (await visibleSentToast(page)) sawSentToast = true;

    if (await findInvitationModal(page)) {
      modalClosedAt = null;
    } else if (modalClosedAt === null) {
      modalClosedAt = Date.now();
    }

    // Keep the page alive long enough for LinkedIn's create-invitation request
    // to finish; the runner closes this page as soon as this function returns.
    if (modalClosedAt !== null && Date.now() - modalClosedAt >= 3000) break;
    await page.waitForTimeout(300);
  }

  if (modalClosedAt === null) {
    throw new Error("LinkedIn did not close the connection invitation modal after clicking send");
  }

  // If a sent toast was seen, the invitation was confirmed by LinkedIn's UI
  if (sawSentToast) return;

  // Otherwise, give LinkedIn 2 seconds and re-check the profile. A pending
  // action is the only reliable UI confirmation when no sent toast appeared.
  await page.waitForTimeout(2000);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (await confirmOnProfile(page, linkedinUrl)) return;
    } catch (error) {
      if (error instanceof LinkedInAuthenticationError) throw error;
    }
    if (attempt === 0) await page.waitForTimeout(2000);
  }

  // Creator Mode may omit a direct Connect button even when no invitation was
  // created. Its absence is therefore not evidence of a successful send.
  throw new UncertainConnectionOutcomeError(
    "LinkedIn closed the invitation modal, but no sent or pending confirmation was observed"
  );
}

/**
 * Sends a LinkedIn connection request without a note.
 * Handles all UI languages (Portuguese, Spanish, English, etc.) and both
 * direct Connect actions and Creator-mode More/Mais dropdown menus.
 */
export interface ConnectionRequestLifecycle {
  /** Persist the attempt immediately before the irreversible Send click. */
  beforeSubmit?: () => void | Promise<void>;
  /** Record that Playwright dispatched the Send click. */
  afterSubmit?: () => void | Promise<void>;
}

export async function sendConnectionRequest(
  page: Page,
  linkedinUrl: string,
  lifecycle: ConnectionRequestLifecycle = {}
): Promise<void> {
  // 1. Preventive warm up on /feed/ — direct navigations to /in/ profiles trigger LinkedIn's profile authwall
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2000);
  } catch (feedErr) {
    console.warn("[connect] Initial feed warm-up warning:", feedErr);
  }

  const feedUrl = page.url();
  if (feedUrl.includes("/login") || feedUrl.includes("/checkpoint") || feedUrl.includes("/uas/")) {
    throw new LinkedInAuthenticationError("Sesión de LinkedIn caducada o cerrada. Por favor actualiza tu Código de Conexión en Configuración.");
  }

  // 2. Navigate to target profile
  try {
    await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ERR_TOO_MANY_REDIRECTS") || msg.includes("ERR_HTTP_RESPONSE_CODE_FAILURE")) {
      try {
        await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(2000);
        await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
      } catch {
        throw new LinkedInAuthenticationError("Sesión de LinkedIn caducada o bloqueada por verificación de seguridad. Por favor actualiza tu Código de Conexión en Configuración.");
      }
    } else {
      throw err;
    }
  }

  await page.waitForTimeout(3000 + Math.random() * 1500);

  const currentUrl = page.url();
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall") || currentUrl.includes("/checkpoint") || currentUrl.includes("/uas/")) {
    throw new LinkedInAuthenticationError("Sesión de LinkedIn caducada o cerrada. Por favor actualiza tu Código de Conexión en Configuración.");
  }

  const isPublicPrompt = await page.locator('#public_profile_contextual-sign-in, [data-tracking-control-name="public_profile_contextual-sign-in"], .contextual-sign-in-modal').count().catch(() => 0);
  if (isPublicPrompt > 0) {
    throw new LinkedInAuthenticationError("Sesión de LinkedIn caducada (perfil cargó en modo público sin autenticación). Por favor actualiza tu Código de Conexión en Configuración.");
  }

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
    await activateConnectAction(page, connectAction, linkedinUrl);
  } else {
    const menuConnect = await clickConnectFromMoreMenu(page, topCard);
    if (menuConnect) {
      await activateConnectAction(page, menuConnect, linkedinUrl);
    } else {
      // Direct deterministic fallback to custom-invite preload URL using target vanity
      const vanity = profileVanityName(linkedinUrl);
      if (vanity) {
        console.log(`[connect] Falling back to direct custom-invite preload URL for ${vanity}`);
        await page.goto(`https://www.linkedin.com/preload/custom-invite/?vanityName=${vanity}`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(2000);
      } else {
        throw new ConnectionPreSubmitError("Could not find the LinkedIn More/Mais menu or its Connect/Conectar option");
      }
    }
  }

  const modal = await waitForInvitationModal(page);
  if (!modal) {
    const error = await visibleError(page);
    if (error) throw new Error(`Connection error: ${error}`);
    const limit = await visibleWeeklyLimit(page);
    if (limit || LIMIT_RE.test(normalizeLabel(await page.locator("body").innerText().catch(() => "")))) {
      throw new WeeklyLimitError(limit || "Weekly connection limit reached");
    }
    throw new ConnectionPreSubmitError("LinkedIn did not open the connection invitation modal");
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
    throw new ConnectionPreSubmitError("LinkedIn requires an email address to connect with this target");
  }

  const sendButton = await findSendButton(modal);
  if (!sendButton) {
    throw new ConnectionPreSubmitError("LinkedIn connection modal opened, but no 'Send without a note' button was found");
  }
  if (!(await waitForEnabled(sendButton))) {
    throw new ConnectionPreSubmitError("LinkedIn connection send button remained disabled");
  }

  // This is the last reversible boundary. Persisting earlier would turn feed,
  // profile, selector or modal failures into invitations that never existed.
  await lifecycle.beforeSubmit?.();

  try {
    await sendButton.click({ force: true, timeout: 10000 });
  } catch (error) {
    throw new UncertainConnectionOutcomeError(`Could not confirm LinkedIn's send-without-note click: ${error instanceof Error ? error.message : String(error)}`);
  }
  await lifecycle.afterSubmit?.();

  await confirmConnectionRequest(page, linkedinUrl);
}
