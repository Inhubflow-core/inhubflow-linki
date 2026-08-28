import type { Page } from "playwright";

/**
 * Visits a LinkedIn profile page. This registers as a profile view on LinkedIn.
 * Reports whether the page shows a 1st-degree badge in all UI languages (PT, ES, EN).
 */
export async function visitProfile(
  page: Page,
  linkedinUrl: string
): Promise<{ isFirstDegree: boolean; messagingUrn: string | null }> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(3000 + Math.random() * 2000);

  // Scope to main profile card
  const topCard = page.locator("main section, div.ph5, div[data-view-name='profile-card']").filter({ has: page.locator("h1") }).first();
  const scope = (await topCard.count().catch(() => 0)) > 0 ? topCard : page.locator("main").first();
  const pageText = await scope.innerText().catch(() => "");

  // Degree badge checks
  const isExplicit2ndOr3rd =
    /\b[23][ºªndrdth°\.]/i.test(pageText) ||
    /•\s*[23][ºª]/i.test(pageText) ||
    /[23][ºª]\s*grau|[23]er\s*grado|[23](?:nd|rd)\s*degree/i.test(pageText);

  const isExplicit1st =
    (/\b1[ºªster°\.]/i.test(pageText) ||
      /•\s*1[ºª]/i.test(pageText) ||
      /1[ºª]\s*grau|1er\s*grado|1st\s*degree/i.test(pageText)) &&
    !isExplicit2ndOr3rd;

  // Check for Message buttons (Portuguese "Mensagem", English "Message", Spanish "Enviar mensaje")
  const messageButton = scope.locator(`
    button:has-text("Mensagem"),
    button:has-text("Message"),
    button:has-text("Enviar mensaje"),
    button[aria-label*="Mensagem"],
    button[aria-label*="Message"],
    button[aria-label*="Enviar mensaje"],
    a[href*="/messaging/compose"],
    a[href*="/messaging/thread"]
  `).first();
  const hasMessageAction = (await messageButton.count().catch(() => 0)) > 0;

  // Check for Connect / Pending buttons
  const connectOrPendingButton = scope.locator(`
    button:has-text("Conectar"),
    button:has-text("Connect"),
    button:has-text("Pendente"),
    button:has-text("Pending"),
    button:has-text("Aguardando"),
    button[aria-label*="Conectar"],
    button[aria-label*="Connect"],
    button[aria-label*="Pendente"],
    button[aria-label*="Pending"]
  `).first();
  const hasConnectOrPending = (await connectOrPendingButton.count().catch(() => 0)) > 0;

  // Message compose link URN extraction if available
  const messageLink = scope.locator('a[href*="/messaging/compose"]').first();
  const messageHref = (await messageLink.count().catch(() => 0)) > 0 ? await messageLink.getAttribute("href").catch(() => null) : null;
  const urnMatch = messageHref?.match(/profileUrn=([^&]+)/);
  const messagingUrn = urnMatch ? decodeURIComponent(urnMatch[1]) : null;

  if (isExplicit1st) {
    return { isFirstDegree: true, messagingUrn };
  }

  if (hasMessageAction && !hasConnectOrPending && !isExplicit2ndOr3rd) {
    return { isFirstDegree: true, messagingUrn };
  }

  if (messageHref && !isExplicit2ndOr3rd) {
    return { isFirstDegree: true, messagingUrn };
  }

  return { isFirstDegree: false, messagingUrn: null };
}
