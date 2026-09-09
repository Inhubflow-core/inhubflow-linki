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

const FIRST_DEGREE = /(?:^|[\s•(])1(?:st|er|º|ª|°)(?:\s*(?:degree|grado|grau))?(?=$|[\s•),.;])/i;
const SECOND_OR_THIRD_DEGREE = /(?:^|[\s•(])(?:2nd|3rd|[23](?:er|º|ª|°))(?:\s*(?:degree|grado|grau))?(?=$|[\s•),.;])/i;

export function detectExplicitProfileDegree(text: string): "first" | "second_or_third" | null {
  if (SECOND_OR_THIRD_DEGREE.test(text)) return "second_or_third";
  return FIRST_DEGREE.test(text) ? "first" : null;
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

  // Restrict evidence to the profile main region so a global navigation Message
  // link cannot be mistaken for the contact's message action.
  const scope = main;
  const visibleText = (await scope.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const explicitDegree = detectExplicitProfileDegree(visibleText);
  const explicitSecondOrThird = explicitDegree === "second_or_third";
  const explicitFirst = explicitDegree === "first";

  const messageAction = scope.locator(`
    button:visible:has-text("Mensagem"),
    button:visible:has-text("Message"),
    button:visible:has-text("Enviar mensaje"),
    button:visible[aria-label*="Mensagem"],
    button:visible[aria-label*="Message"],
    button:visible[aria-label*="Enviar mensaje"],
    a:visible[href*="/messaging/compose"],
    a:visible[href*="/messaging/thread"]
  `).first();
  const connectAction = scope.locator(`
    button:visible:has-text("Conectar"),
    button:visible:has-text("Connect"),
    button:visible[aria-label*="Conectar"],
    button:visible[aria-label*="Connect"]
  `).first();
  const pendingAction = scope.locator(`
    button:visible:has-text("Pendente"),
    button:visible:has-text("Pending"),
    button:visible:has-text("Pendiente"),
    button:visible:has-text("Aguardando"),
    button:visible[aria-label*="Pendente"],
    button:visible[aria-label*="Pending"],
    button:visible[aria-label*="Pendiente"]
  `).first();

  const hasMessageAction = (await messageAction.count().catch(() => 0)) > 0;
  const hasConnectAction = (await connectAction.count().catch(() => 0)) > 0;
  const hasPendingAction = (await pendingAction.count().catch(() => 0)) > 0;
  const messageLink = scope.locator('a:visible[href*="/messaging/compose"]').first();
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
    // Open Profiles can expose a Message action to non-connections. Keep the
    // signal for diagnostics/URN discovery, but never promote degree from it.
    reason = messageHref ? "message_link_without_degree" : "message_action_without_degree";
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
