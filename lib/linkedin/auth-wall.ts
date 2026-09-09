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
    const startUrl = page.url();
    if (isLinkedInAuthenticationWall(startUrl)) {
      console.warn(`[auth-wall] Probe: start URL matches auth wall: ${startUrl}`);
      return true;
    }
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch((e) => {
      console.warn(`[auth-wall] Probe navigation warning: ${e instanceof Error ? e.message : String(e)}`);
    });
    await page.waitForTimeout(1500);
    const feedUrl = page.url();
    if (isLinkedInAuthenticationWall(feedUrl)) {
      console.warn(`[auth-wall] Probe: feed redirected to auth wall: ${feedUrl}`);
      return true;
    }
    const publicSignIn = (await page.locator(PUBLIC_SIGN_IN_SELECTOR).count().catch(() => 0)) > 0;
    if (publicSignIn) {
      console.warn(`[auth-wall] Probe: public sign-in prompt detected on ${feedUrl}`);
      return true;
    }
    console.log(`[auth-wall] Probe: feed confirmed authenticated (${feedUrl})`);
    return false;
  } catch {
    // A network/browser failure is not evidence that LinkedIn revoked the
    // session. The next real navigation can make that determination.
    return false;
  }
}
