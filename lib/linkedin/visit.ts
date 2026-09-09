import type { Page } from "playwright";
import { isLinkedInAuthenticationWall, LinkedInAuthenticationError } from "./auth-wall";

export interface ProfileConnectionEvidence {
  pageUrl: string;
  visibleTextSample: string;
  explicitDegree: "first" | "second_or_third" | null;
  hasMessageAction: boolean;
  hasConnectAction: boolean;
  hasPendingAction: boolean;
  messagingUrn: string | null;
  reason: string;
}

export interface ProfileVisitResult {
  isFirstDegree: boolean;
  messagingUrn: string | null;
  evidence: ProfileConnectionEvidence;
}

const FIRST_DEGREE = /(?:^|[\s•·(])1(?:st|\.?[º°ª]|\.?er)(?:\s*(?:degree|grado|grau|degr[eé]|grad))?(?=$|[\s•·),.;])/i;
const SECOND_OR_THIRD_DEGREE = /(?:^|[\s•·(])(?:2nd|3rd|[23](?:nd|rd|\.?[º°ª]|\.?er|\.?do|\.?ro|\.?e))(?:\s*(?:degree|grado|grau|degr[eé]|grad))?(?=$|[\s•·),.;])/i;

export function detectExplicitProfileDegree(text: string): "first" | "second_or_third" | null {
  if (SECOND_OR_THIRD_DEGREE.test(text)) return "second_or_third";
  if (FIRST_DEGREE.test(text)) return "first";
  return null;
}

/**
 * Visits a LinkedIn profile and returns connection evidence. This is a
 * read-only verification used immediately before a message send; it never
 * treats the absence of a pending invite as proof of acceptance.
 */
export async function visitProfile(page: Page, linkedinUrl: string): Promise<ProfileVisitResult> {
  try {
    await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ERR_TOO_MANY_REDIRECTS") || msg.includes("ERR_HTTP_RESPONSE_CODE_FAILURE")) {
      // Warm up session via /feed to establish cookies/CSRF tokens, then retry
      try {
        await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25_000 });
        await page.waitForTimeout(2_000);
        await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (
          retryMsg.includes("ERR_TOO_MANY_REDIRECTS") ||
          retryMsg.includes("ERR_HTTP_RESPONSE_CODE_FAILURE") ||
          isLinkedInAuthenticationWall(page.url())
        ) {
          throw new LinkedInAuthenticationError("Sesión de LinkedIn caducada o bloqueada por verificación de seguridad. Por favor re-autentica tu cuenta en Configuración con un nuevo Código de Conexión.");
        }
        throw retryErr;
      }
    } else {
      throw err;
    }
  }
  await page.waitForTimeout(3_000 + Math.random() * 2_000);

  const pageUrl = page.url();
  if (isLinkedInAuthenticationWall(pageUrl)) {
    throw new LinkedInAuthenticationError(`LinkedIn authentication wall while checking profile (${pageUrl})`);
  }

  const main = page.locator("main").first();
  const mainCount = await main.count().catch(() => 0);
  if (mainCount === 0) {
    return {
      isFirstDegree: false,
      messagingUrn: null,
      evidence: {
        pageUrl,
        visibleTextSample: "",
        explicitDegree: null,
        hasMessageAction: false,
        hasConnectAction: false,
        hasPendingAction: false,
        messagingUrn: null,
        reason: "profile_main_missing",
      },
    };
  }

  // Restrict degree detection primarily to the top card / header area to avoid
  // false positives from experience/education bodies (e.g. "3er año", "2º puesto").
  const scope = main;
  const topCard = page.locator("main section:has(h1), main .pv-top-card, main section").first();
  const topCardText = (await topCard.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const badgeLocator = topCard.locator(".dist-value, span[class*='distance-badge'], span[class*='dist-value']").first();
  const badgeText = (await badgeLocator.innerText().catch(() => "")).trim();

  const visibleText = (await scope.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const explicitDegree =
    (badgeText ? detectExplicitProfileDegree(badgeText) : null) ??
    (topCardText ? detectExplicitProfileDegree(topCardText) : null) ??
    detectExplicitProfileDegree(visibleText.slice(0, 600));

  const explicitSecondOrThird = explicitDegree === "second_or_third";
  const explicitFirst = explicitDegree === "first";

  const messageAction = scope.locator(`
    button:visible:has-text("Mensaje"),
    button:visible:has-text("Mensagem"),
    button:visible:has-text("Message"),
    button:visible:has-text("Enviar mensaje"),
    button:visible:has-text("Enviar mensagem"),
    button:visible:has-text("Send message"),
    button:visible[aria-label*="Mensaje" i],
    button:visible[aria-label*="Mensagem" i],
    button:visible[aria-label*="Message" i],
    div[role="button"]:visible:has-text("Mensaje"),
    div[role="button"]:visible:has-text("Mensagem"),
    div[role="button"]:visible:has-text("Message"),
    a:visible[href*="/messaging/compose"],
    a:visible[href*="/messaging/thread"],
    a:visible[href*="/messaging/"]
  `).first();
  const connectAction = scope.locator(`
    button:visible:has-text("Conectar"),
    button:visible:has-text("Connect"),
    button:visible[aria-label*="Conectar" i],
    button:visible[aria-label*="Connect" i],
    div[role="button"]:visible:has-text("Conectar"),
    div[role="button"]:visible:has-text("Connect")
  `).first();
  const pendingAction = scope.locator(`
    button:visible:has-text("Pendente"),
    button:visible:has-text("Pending"),
    button:visible:has-text("Pendiente"),
    button:visible:has-text("Aguardando"),
    button:visible[aria-label*="Pendente" i],
    button:visible[aria-label*="Pending" i],
    button:visible[aria-label*="Pendiente" i],
    button:visible[aria-label*="Aguardando" i],
    div[role="button"]:visible:has-text("Pendiente"),
    div[role="button"]:visible:has-text("Pending"),
    div[role="button"]:visible:has-text("Pendente")
  `).first();

  const hasMessageAction = (await messageAction.count().catch(() => 0)) > 0;
  const hasConnectAction = (await connectAction.count().catch(() => 0)) > 0;
  const hasPendingAction = (await pendingAction.count().catch(() => 0)) > 0;
  const messageLink = scope.locator('a:visible[href*="/messaging/compose"], a:visible[href*="/messaging/thread"]').first();
  const messageHref = (await messageLink.count().catch(() => 0)) > 0
    ? await messageLink.getAttribute("href").catch(() => null)
    : null;
  const urnMatch = messageHref?.match(/profileUrn=([^&]+)/);
  const messagingUrn = urnMatch ? decodeURIComponent(urnMatch[1]) : null;

  let isFirstDegree = false;
  let reason = "no_positive_connection_evidence";
  if (explicitSecondOrThird) {
    reason = "explicit_second_or_third_degree";
  } else if (hasConnectAction || hasPendingAction) {
    reason = hasPendingAction ? "explicit_pending_action" : "explicit_connect_action";
  } else if (explicitFirst) {
    isFirstDegree = true;
    reason = "explicit_first_degree_badge";
  } else if (hasMessageAction || messageHref) {
    // If no degree badge was detected, verify if "Connect" or "Pending" is
    // hidden inside the More / 3-dots menu (common in Creator Mode & Open Profiles).
    const moreMenu = await inspectMoreMenuForConnectionState(page, topCard);
    if (moreMenu.hasConnect) {
      reason = "more_menu_has_connect_action";
    } else if (moreMenu.hasPending) {
      reason = "more_menu_has_pending_action";
    } else if (moreMenu.hasRemoveConnection) {
      isFirstDegree = true;
      reason = "more_menu_has_remove_connection_action";
    } else {
      isFirstDegree = true;
      reason = "message_action_without_connect_or_pending";
    }
  }

  return {
    isFirstDegree,
    messagingUrn: isFirstDegree ? messagingUrn : null,
    evidence: {
      pageUrl,
      visibleTextSample: visibleText.slice(0, 500),
      explicitDegree: explicitSecondOrThird ? "second_or_third" : explicitFirst ? "first" : null,
      hasMessageAction,
      hasConnectAction,
      hasPendingAction,
      messagingUrn,
      reason,
    },
  };
}

async function inspectMoreMenuForConnectionState(
  page: Page,
  topCard: import("playwright").Locator
): Promise<{ hasConnect: boolean; hasPending: boolean; hasRemoveConnection: boolean }> {
  const result = { hasConnect: false, hasPending: false, hasRemoveConnection: false };

  const moreTrigger = topCard.locator(`
    button[aria-label*="más acciones" i],
    button[aria-label*="more actions" i],
    button[aria-label*="mais ações" i],
    button[aria-label*="más opciones" i],
    button[aria-label*="more options" i],
    button[aria-label*="mais opções" i],
    button:has(svg[data-test-icon*="overflow"]),
    button:has(li-icon[type*="overflow"]),
    button[aria-label*="más" i],
    button[aria-label*="mais" i],
    button[aria-label*="more" i],
    button.artdeco-dropdown__trigger
  `).first();

  if ((await moreTrigger.count().catch(() => 0)) === 0 || !(await moreTrigger.isVisible().catch(() => false))) {
    return result;
  }

  try {
    await moreTrigger.scrollIntoViewIfNeeded().catch(() => {});
    await moreTrigger.click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);

    const menu = page.locator('.artdeco-dropdown__content:visible, [role="menu"]:visible, .artdeco-dropdown__menu:visible').first();
    if ((await menu.count().catch(() => 0)) > 0 && (await menu.isVisible().catch(() => false))) {
      const menuText = (await menu.innerText().catch(() => "")).toLowerCase();

      if (/(?:^|\s)(?:conectar|connect|convidar|invitar|invite|se connecter)(?:\s|$)/i.test(menuText)) {
        result.hasConnect = true;
      }
      if (/(?:pendente|pending|pendiente|aguardando|cancelar convite|retirar convite|retirar invitaci[oó]n|cancelar solicitud|withdraw)/i.test(menuText)) {
        result.hasPending = true;
      }
      if (/(?:remove connection|eliminar contacto|remover conex[aã]o|desconectar)/i.test(menuText)) {
        result.hasRemoveConnection = true;
      }
    }
  } catch (err) {
    console.warn("[visit] Warning while inspecting More menu:", err);
  } finally {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }

  return result;
}
