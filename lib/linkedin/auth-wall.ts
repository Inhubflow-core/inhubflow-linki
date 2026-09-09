import type { Page } from "playwright";

const AUTH_WALL_PATTERN = /\/login|\/authwall|\/checkpoint|\/uas\//i;
const PUBLIC_SIGN_IN_SELECTOR = [
  "#public_profile_contextual-sign-in",
  '[data-tracking-control-name="public_profile_contextual-sign-in"]',
  ".contextual-sign-in-modal",
].join(",");

export class LinkedInAuthenticationError extends Error {
  constructor(
    message = "LinkedIn authentication is no longer valid",
    readonly submissionAttempted = false
  ) {
    super(message);
    this.name = "LinkedInAuthenticationError";
  }
}

export function isLinkedInAuthenticationWall(url: string): boolean {
  return AUTH_WALL_PATTERN.test(url);
}

/**
 * Confirms an API authorization failure against a separate, user-facing page.
 * Voyager may return 401/403 for CSRF, endpoint or rate-limit reasons while the
 * browser session itself is still valid, so those statuses cannot log an
 * account out on their own.
 */
export async function probeLinkedInAuthenticationWall(page: Page): Promise<boolean> {
  try {
    if (isLinkedInAuthenticationWall(page.url())) return true;
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => {});
    await page.waitForTimeout(1500);
    if (isLinkedInAuthenticationWall(page.url())) return true;
    return (await page.locator(PUBLIC_SIGN_IN_SELECTOR).count().catch(() => 0)) > 0;
  } catch {
    // A network/browser failure is not evidence that LinkedIn revoked the
    // session. The next real navigation can make that determination.
    return false;
  }
}
