import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getSessionPage } from "@/lib/linkedin/session";
import { loadCampaignTargetScopes } from "@/lib/linkedin/campaign-inbox";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const accountId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!accountId) return res.status(400).json({ error: "Missing account id" });

  const db = getDb();
  const account = db.prepare("SELECT id, name, email, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; name: string; email: string; is_authenticated: number }
    | undefined;

  if (!account) return res.status(404).json({ error: "Account not found in DB" });

  const scopes = loadCampaignTargetScopes(db, accountId);
  const targets = db.prepare(`
    SELECT t.id, t.full_name, t.linkedin_url, t.degree, t.connection_requested_at, t.message_sent_at, t.last_replied_at
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN runs r ON r.id = rp.run_id
    WHERE r.account_id = ?
  `).all(accountId);

  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    account: { id: account.id, name: account.name, email: account.email, is_authenticated: account.is_authenticated },
    database: {
      campaignTargetCount: targets.length,
      targetsSample: targets.slice(0, 5),
      scopesCount: scopes.length,
      scopes: scopes.slice(0, 5),
    },
    browser: {},
  };

  let page;
  try {
    page = await getSessionPage(accountId);
    const initialUrl = page.url();

    // Navigate to messaging
    await page.goto("https://www.linkedin.com/messaging/", { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    const pageTitle = await page.title();
    const isAuthWall = /\/login|\/authwall|\/checkpoint|\/uas\//i.test(currentUrl);

    // Extract DOM information from LinkedIn messaging page
    const domData = await page.evaluate(() => {
      const cookies = document.cookie.split("; ").reduce((acc: Record<string, string>, c) => {
        const idx = c.indexOf("=");
        if (idx > 0) acc[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
        return acc;
      }, {});

      const conversationElements = Array.from(
        document.querySelectorAll('.msg-conversation-listitem, li[class*="msg-conversation"]')
      );

      const conversations = conversationElements.map((el) => {
        const link = el.querySelector('a[href*="/messaging/thread/"], a[class*="msg-conversation"]');
        const href = link?.getAttribute("href") || "";

        const nameEl = el.querySelector('.msg-conversation-listitem__participant-names, [class*="participant-name"], h3');
        const name = (nameEl?.textContent || "").trim();

        const profileLink = el.querySelector('a[href*="/in/"]');
        const profileUrl = profileLink ? profileLink.getAttribute("href") : null;

        const snippetEl = el.querySelector('.msg-conversation-card__message-snippet, [class*="message-snippet"]');
        const lastMessage = (snippetEl?.textContent || "").trim();

        const timeEl = el.querySelector('time, [class*="time-stamp"]');
        const timeText = (timeEl?.textContent || "").trim();

        return { href, name, profileUrl, lastMessage, timeText };
      });

      const bodySnippet = document.body ? document.body.innerText.slice(0, 1000) : "";

      return {
        hasJSessionId: !!cookies.JSESSIONID || !!cookies.jsessionid,
        hasLiAt: !!cookies.li_at,
        conversationsFoundInDom: conversations.length,
        conversations,
        bodySnippet,
      };
    });

    // Test Voyager REST API from page context
    const apiTest = await page.evaluate(async () => {
      try {
        const cookies = document.cookie.split("; ").reduce((acc: Record<string, string>, c) => {
          const idx = c.indexOf("=");
          if (idx > 0) acc[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
          return acc;
        }, {});
        const csrf = (cookies.JSESSIONID || cookies.jsessionid || "").replace(/\"/g, "");

        const res = await fetch("https://www.linkedin.com/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX&q=participants&start=0&count=10", {
          method: "GET",
          headers: {
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "x-restli-protocol-version": "2.0.0",
            ...(csrf ? { "csrf-token": csrf } : {}),
          },
          credentials: "include",
        });

        let body: unknown = null;
        try { body = await res.json(); } catch { /* ignore */ }
        return { status: res.status, ok: res.ok, bodyType: typeof body, hasData: !!body };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // Capture screenshot base64
    let screenshotBase64: string | null = null;
    try {
      const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
      screenshotBase64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    } catch { /* screenshot optional */ }

    report.browser = {
      initialUrl,
      currentUrl,
      pageTitle,
      isAuthWall,
      dom: domData,
      voyagerApiTest: apiTest,
      screenshot: screenshotBase64,
    };

    return res.status(200).json(report);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    return res.status(500).json(report);
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }
}
