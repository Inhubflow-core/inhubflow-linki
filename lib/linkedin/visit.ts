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

  const topCard = page.locator("main section").filter({ has: page.locator("h1") }).first();
  const pageText = await topCard.innerText().catch(() => "");

  const isExplicit2ndOr3rd = /\b[23][ºªndrdth°\.]/i.test(pageText) || /•\s*[23]º/i.test(pageText);
  const isExplicit1st = (/\b1[ºªster°\.]/i.test(pageText) || /•\s*1º/i.test(pageText)) && !isExplicit2ndOr3rd;

  const messageLink = topCard.locator('a[href*="/messaging/compose"]').first();
  const messageHref = (await messageLink.count()) > 0 ? await messageLink.getAttribute("href").catch(() => null) : null;
  const urnMatch = messageHref?.match(/profileUrn=([^&]+)/);
  const messagingUrn = urnMatch ? decodeURIComponent(urnMatch[1]) : null;

  if (isExplicit1st) {
    return { isFirstDegree: true, messagingUrn };
  }

  if (messageHref && !isExplicit2ndOr3rd) {
    return { isFirstDegree: true, messagingUrn };
  }

  return { isFirstDegree: false, messagingUrn: null };
}
