import type { Page } from "playwright";
import { getDb } from "@/lib/db";
import { getSessionPage, saveSessionState, markNeedsReauth } from "@/lib/linkedin/session";
import {
  calculateConnectionScanFloor,
  canonicalLinkedInVanity,
  matchAcceptedConnection,
  parseVoyagerConnections,
  type PendingConnectionTarget,
} from "./connection-reconciliation";

/**
 * Reconciles accepted LinkedIn connections from the authoritative connections
 * API. The invitation-manager "missing means accepted" heuristic is deliberately
 * not used: an invitation can disappear because it expired or was withdrawn.
 *
 * Incremental passes always scan far enough to cover every still-actionable
 * request on this account, even when that is older than the normal cursor
 * overlap. A failed or incomplete pass never advances the cursor or its
 * freshness timestamp.
 */

const ACCEPTED_SYNC_INTERVAL_MS = 8 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 60;
const OVERLAP_MARGIN_MS = 24 * 60 * 60 * 1000;
const REQUEST_MARGIN_MS = 24 * 60 * 60 * 1000;
const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
const DECORATION = "com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16";
const AUTH_WALL = /\/login|\/authwall|\/checkpoint|\/uas\//i;

export function shouldSyncAccepted(accountId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT accepted_sync_at FROM accounts WHERE id = ?").get(accountId) as
    | { accepted_sync_at: string | null }
    | undefined;
  if (!row?.accepted_sync_at) return true;
  return Date.now() - new Date(row.accepted_sync_at).getTime() >= ACCEPTED_SYNC_INTERVAL_MS;
}

export interface AcceptedSyncResult {
  success: boolean;
  partial: boolean;
  stamped: number;
  unmarked: number;
  pages: number;
  connectionsRead: number;
  pendingTargets: number;
  matchedTargets: number;
  declaredTotal: number | null;
  reason?: "account_missing" | "auth_wall" | "api_error" | "page_limit" | "invalid_response";
}

interface ApiPageResult {
  connections: ReturnType<typeof parseVoyagerConnections>["connections"];
  referencedElements: number;
}

interface AccountTarget extends PendingConnectionTarget {
  accountId: string;
}

function parseDeclaredTotal(text: string): number | null {
  // Keep the number permissive: LinkedIn has used EN, ES and PT-BR labels and
  // both comma and period thousands separators in the same account.
  const match = text.match(/([\d.,]+)\s+(?:connections?|conex[õo]es?|contactos?|conexiones?)/i);
  if (!match) return null;
  const digits = match[1].replace(/[^\d]/g, "");
  const total = Number(digits);
  return Number.isSafeInteger(total) ? total : null;
}

function loadPendingTargets(db: ReturnType<typeof getDb>, accountId: string): AccountTarget[] {
  const rows = db.prepare(`
    SELECT DISTINCT
      t.id,
      t.linkedin_url AS linkedinUrl,
      t.messaging_urn AS messagingUrn,
      t.linkedin_member_urn AS linkedinMemberUrn,
      t.connection_requested_at AS connectionRequestedAt,
      r.account_id AS accountId
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN runs r ON r.id = rp.run_id
    JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
    WHERE r.account_id = ?
      AND r.status IN ('running', 'paused', 'completed')
      AND rt.state NOT IN ('completed', 'failed', 'skipped')
      AND t.connection_requested_at IS NOT NULL
      AND (t.degree IS NULL OR t.degree != 1)
      AND t.connected_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM run_profiles other_rp
        JOIN runs other_r ON other_r.id = other_rp.run_id
        WHERE other_rp.target_id = t.id
          AND other_r.account_id != ?
      )
  `).all(accountId, accountId) as AccountTarget[];
  return rows;
}

export async function syncAcceptedConnectionsDetailed(accountId: string): Promise<AcceptedSyncResult> {
  const db = getDb();
  const account = db.prepare("SELECT id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number }
    | undefined;
  if (!account) {
    return { success: false, partial: false, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: 0, matchedTargets: 0, declaredTotal: null, reason: "account_missing" };
  }

  const pendingTargets = loadPendingTargets(db, accountId);
  const boundaryRow = db.prepare("SELECT connections_synced_through_ms FROM accounts WHERE id = ?").get(accountId) as
    | { connections_synced_through_ms: number | null }
    | undefined;
  const boundary = boundaryRow?.connections_synced_through_ms ?? null;
  const isFullPass = boundary === null;
  const scanFloor = calculateConnectionScanFloor({
    boundaryMs: boundary,
    pendingRequestedAt: pendingTargets.map((target) => target.connectionRequestedAt),
    overlapMs: OVERLAP_MARGIN_MS,
    maxWaitMs: MAX_WAIT_MS,
    requestMarginMs: REQUEST_MARGIN_MS,
  });

  let page: Page | null = null;
  let sessionWall = false;
  let completed = false;
  let pages = 0;
  let connectionsRead = 0;
  let stamped = 0;
  let matchedTargets = 0;
  let unmarked = 0;
  let declaredTotal: number | null = null;
  let newestSeen: number | null = null;
  let reachedFloor = false;
  let apiError = false;
  const seenIdentities = new Set<string>();
  const seenVanities = new Set<string>();

  try {
    if (!account.is_authenticated) {
      return { success: false, partial: false, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: pendingTargets.length, matchedTargets: 0, declaredTotal: null, reason: "auth_wall" };
    }

    page = await getSessionPage(accountId);
    await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", {
      waitUntil: "domcontentloaded",
      timeout: 35_000,
    });
    await page.waitForTimeout(3500 + Math.random() * 1500);
    if (AUTH_WALL.test(page.url())) {
      sessionWall = true;
      return { success: false, partial: false, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: pendingTargets.length, matchedTargets: 0, declaredTotal: null, reason: "auth_wall" };
    }
    declaredTotal = parseDeclaredTotal(await page.locator("body").innerText().catch(() => ""));

    const stampAccepted = db.prepare(
      "UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, ?), messaging_urn = COALESCE(messaging_urn, ?) WHERE id = ? AND (degree IS NULL OR degree != 1)"
    );

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const result = await fetchConnectionsPage(page, pageIndex * PAGE_SIZE, PAGE_SIZE);
      pages++;
      if (!result) {
        apiError = true;
        break;
      }
      if (result.referencedElements > 0 && result.connections.length === 0) {
        console.warn(`[sync-accepted] Voyager response had ${result.referencedElements} references but no parseable connections`);
        apiError = true;
        break;
      }
      if (result.connections.length === 0) {
        reachedFloor = true;
        break;
      }

      let pageReachedFloor = false;
      for (const connection of result.connections) {
        const identityKey = connection.memberUrn ?? `${connection.vanity ?? "unknown"}:${connection.createdAt}`;
        if (!seenIdentities.has(identityKey)) {
          seenIdentities.add(identityKey);
          connectionsRead++;
        }
        if (connection.vanity) {
          seenVanities.add(connection.vanity);
          const matches = matchAcceptedConnection(connection, pendingTargets);
          if (matches.targetId) {
            matchedTargets++;
            const changed = stampAccepted.run(msToSqlite(connection.createdAt), connection.memberUrn, matches.targetId).changes;
            if (changed === 1) {
              stamped++;
              console.log(`[sync-accepted] Accepted via ${matches.matchedBy}: ${matches.targetId} (${connection.vanity})`);
            }
          } else if (matches.conflictTargetIds.length > 0) {
            console.warn(`[sync-accepted] Ambiguous vanity ${connection.vanity}; refusing targets ${matches.conflictTargetIds.join(",")}`);
          }
        } else if (connection.memberUrn) {
          const matches = matchAcceptedConnection(connection, pendingTargets);
          if (matches.targetId) {
            matchedTargets++;
            const changed = stampAccepted.run(msToSqlite(connection.createdAt), connection.memberUrn, matches.targetId).changes;
            if (changed === 1) stamped++;
          }
        }

        if (newestSeen === null || connection.createdAt > newestSeen) newestSeen = connection.createdAt;
        if (scanFloor !== null && connection.createdAt < scanFloor) {
          pageReachedFloor = true;
          break;
        }
      }

      if (pageReachedFloor) {
        reachedFloor = true;
        break;
      }
      if (Math.max(result.referencedElements, result.connections.length) < PAGE_SIZE) {
        reachedFloor = true;
        break;
      }
      await page.waitForTimeout(900 + Math.random() * 700);
    }

    if (!reachedFloor && !apiError) {
      console.warn(`[sync-accepted] Page safety cap reached before scan floor (${MAX_PAGES} pages)`);
    }

    const fullPassVerified = isFullPass && reachedFloor && !apiError && declaredTotal !== null && Math.abs(connectionsRead - declaredTotal) <= 5;
    if (fullPassVerified) {
      const degreeOne = db.prepare(`
        SELECT DISTINCT t.id, t.linkedin_url
        FROM targets t
        JOIN run_profiles rp ON rp.target_id = t.id
        JOIN runs r ON r.id = rp.run_id
        WHERE r.account_id = ?
          AND t.degree = 1
          AND t.linkedin_url LIKE '%/in/%'
          AND NOT EXISTS (
            SELECT 1
            FROM run_profiles other_rp
            JOIN runs other_r ON other_r.id = other_rp.run_id
            WHERE other_rp.target_id = t.id
              AND other_r.account_id != ?
          )
      `).all(accountId, accountId) as Array<{ id: string; linkedin_url: string }>;
      const unmark = db.prepare("UPDATE targets SET degree = NULL, connected_at = NULL WHERE id = ?");
      db.transaction(() => {
        for (const target of degreeOne) {
          const vanity = canonicalLinkedInVanity(target.linkedin_url);
          if (vanity && !seenVanities.has(vanity)) {
            unmark.run(target.id);
            unmarked++;
          }
        }
      })();
    }

    completed = reachedFloor && !apiError;
    if (completed && newestSeen !== null) {
      db.prepare("UPDATE accounts SET connections_synced_through_ms = ? WHERE id = ?").run(newestSeen, accountId);
    }
    if (completed && declaredTotal !== null) {
      db.prepare("UPDATE accounts SET li_connections = ? WHERE id = ?").run(declaredTotal, accountId);
    }

    const result: AcceptedSyncResult = {
      success: completed,
      partial: !completed,
      stamped,
      unmarked,
      pages,
      connectionsRead,
      pendingTargets: pendingTargets.length,
      matchedTargets,
      declaredTotal,
      reason: apiError ? "api_error" : !reachedFloor ? "page_limit" : undefined,
    };
    console.log(`[sync-accepted] ${completed ? "Complete" : "Incomplete"}: ${stamped} accepted, ${matchedTargets} matches, ${connectionsRead} connections, ${pages} pages (floor=${scanFloor ?? "full"}, declared=${declaredTotal ?? "unknown"})`);
    return result;
  } catch (error) {
    console.warn(`[sync-accepted] Failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      success: false,
      partial: true,
      stamped,
      unmarked,
      pages,
      connectionsRead,
      pendingTargets: pendingTargets.length,
      matchedTargets,
      declaredTotal,
      reason: "invalid_response",
    };
  } finally {
    if (page) {
      let url = "";
      try { url = page.url(); } catch { /* page gone */ }
      try { await page.close(); } catch { /* ignore */ }
      if (sessionWall || AUTH_WALL.test(url)) {
        try { await markNeedsReauth(accountId); } catch { /* ignore */ }
      } else {
        try { await saveSessionState(accountId); } catch { /* ignore */ }
      }
    }
    // A failed pass must not make the next retry wait eight hours.
    if (completed) db.prepare("UPDATE accounts SET accepted_sync_at = datetime('now') WHERE id = ?").run(accountId);
  }
}

/** Backwards-compatible count API used by the runner. */
export async function syncAcceptedConnections(accountId: string): Promise<number> {
  const result = await syncAcceptedConnectionsDetailed(accountId);
  return result.stamped;
}

function msToSqlite(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

async function fetchConnectionsPage(page: Page, start: number, count: number): Promise<ApiPageResult | null> {
  const payload = await page.evaluate(
    async ({ start, count, decoration }) => {
      const cookies = document.cookie.split("; ").reduce((values: Record<string, string>, cookie) => {
        const index = cookie.indexOf("=");
        if (index > 0) values[cookie.slice(0, index)] = cookie.slice(index + 1);
        return values;
      }, {});
      const csrf = (cookies.JSESSIONID || "").replace(/"/g, "");
      const url = `https://www.linkedin.com/voyager/api/relationships/dash/connections?decorationId=${decoration}&count=${count}&q=search&sortType=RECENTLY_ADDED&start=${start}`;
      try {
        const response = await fetch(url, {
          headers: {
            "csrf-token": csrf,
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "x-restli-protocol-version": "2.0.0",
            "x-li-lang": "en_US",
          },
          credentials: "include",
        });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    },
    { start, count, decoration: DECORATION }
  ) as import("./connection-reconciliation").VoyagerConnectionsPayload | null;

  if (!payload) return null;
  const parsed = parseVoyagerConnections(payload);
  return { connections: parsed.connections, referencedElements: parsed.referencedElements };
}
