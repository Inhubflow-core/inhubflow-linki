import type { Page } from "playwright";
import { getDb } from "@/lib/db";
import { getSessionPage, markNeedsReauth, saveSessionState } from "@/lib/linkedin/session";
import {
  isLinkedInAuthenticationWall,
  LinkedInAuthenticationError,
  probeLinkedInAuthenticationWall,
} from "./auth-wall";
import { releaseRuntimeLease, renewRuntimeLease, tryAcquireRuntimeLease } from "../runtime-lease";
import { linkedinCsrfFromCookies } from "./cookie-state";
import {
  calculateConnectionScanFloor,
  canonicalLinkedInVanity,
  matchAcceptedConnection,
  normalizeVanitySlug,
  parseVoyagerConnections,
  type PendingConnectionTarget,
} from "./connection-reconciliation";
import { autoAdvanceTargetByTrigger } from "@/lib/pipeline/pipeline-service";

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
const ACCEPTED_SYNC_LEASE_MS = 5 * 60 * 1000;
const ACCEPTED_SYNC_HEARTBEAT_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 60;
const OVERLAP_MARGIN_MS = 24 * 60 * 60 * 1000;
const REQUEST_MARGIN_MS = 24 * 60 * 60 * 1000;
const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
const DECORATION = "com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16";

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
  reason?: "account_missing" | "auth_wall" | "api_error" | "page_limit" | "invalid_response" | "in_progress";
}

interface ApiPageResult {
  connections: ReturnType<typeof parseVoyagerConnections>["connections"];
  referencedElements: number;
}

class LinkedInConnectionsApiAuthorizationError extends Error {
  constructor(readonly status: number) {
    super(`LinkedIn connections API returned HTTP ${status}`);
    this.name = "LinkedInConnectionsApiAuthorizationError";
  }
}

class AcceptedSyncLeaseLostError extends Error {
  constructor() {
    super("Accepted-connections sync lease was lost");
    this.name = "AcceptedSyncLeaseLostError";
  }
}

interface AccountTarget extends PendingConnectionTarget {
  accountId: string;
}

function isLinkedInPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com"));
  } catch {
    return false;
  }
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

  if (!account.is_authenticated) {
    return { success: false, partial: false, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: pendingTargets.length, matchedTargets: 0, declaredTotal: null, reason: "auth_wall" };
  }

  const leaseKey = `linkedin:accepted-sync:${accountId}`;
  let leaseOwner: string | null = null;
  try {
    leaseOwner = tryAcquireRuntimeLease(db, leaseKey, ACCEPTED_SYNC_LEASE_MS);
  } catch (error) {
    console.warn(`[sync-accepted] Could not acquire account lease: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, partial: true, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: pendingTargets.length, matchedTargets: 0, declaredTotal: null, reason: "invalid_response" };
  }
  if (!leaseOwner) {
    return { success: false, partial: true, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: pendingTargets.length, matchedTargets: 0, declaredTotal: null, reason: "in_progress" };
  }

  let leaseLost = false;
  const leaseHeartbeat = setInterval(() => {
    try {
      if (!renewRuntimeLease(db, leaseKey, leaseOwner!, ACCEPTED_SYNC_LEASE_MS)) {
        leaseLost = true;
      }
    } catch (error) {
      console.warn(`[sync-accepted] Could not renew account lease: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, ACCEPTED_SYNC_HEARTBEAT_MS);
  leaseHeartbeat.unref();

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
  const seenNormalizedVanities = new Set<string>();

  try {
    if (leaseLost) throw new AcceptedSyncLeaseLostError();
    page = await getSessionPage(accountId);
    await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", {
      waitUntil: "domcontentloaded",
      timeout: 35_000,
    }).catch((error) => {
      console.warn(`[sync-accepted] Connections page navigation warning: ${error instanceof Error ? error.message : String(error)}`);
    });
    await page.waitForTimeout(3000 + Math.random() * 1500);
    if (isLinkedInAuthenticationWall(page.url())) {
      // Warm up session on /feed/ and retry once
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25_000 }).catch((error) => {
        console.warn(`[sync-accepted] Feed warm-up warning: ${error instanceof Error ? error.message : String(error)}`);
      });
      await page.waitForTimeout(2000);
      if (!isLinkedInAuthenticationWall(page.url())) {
        await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", {
          waitUntil: "domcontentloaded",
          timeout: 35_000,
        }).catch((error) => {
          console.warn(`[sync-accepted] Connections retry warning: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
    const currentUrl = page.url();
    if (isLinkedInAuthenticationWall(currentUrl)) {
      sessionWall = true;
      return { success: false, partial: false, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: pendingTargets.length, matchedTargets: 0, declaredTotal: null, reason: "auth_wall" };
    }
    if (!isLinkedInPageUrl(currentUrl)) {
      return { success: false, partial: true, stamped: 0, unmarked: 0, pages: 0, connectionsRead: 0, pendingTargets: pendingTargets.length, matchedTargets: 0, declaredTotal: null, reason: "invalid_response" };
    }
    declaredTotal = parseDeclaredTotal(await page.locator("body").innerText().catch(() => ""));

    const stampAccepted = db.prepare(
      "UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, ?), messaging_urn = COALESCE(messaging_urn, ?) WHERE id = ? AND (degree IS NULL OR degree != 1)"
    );

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      if (leaseLost) throw new AcceptedSyncLeaseLostError();
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
          const normV = normalizeVanitySlug(connection.vanity);
          if (normV) seenNormalizedVanities.add(normV);

          const matches = matchAcceptedConnection(connection, pendingTargets);
          if (matches.targetId) {
            matchedTargets++;
            const changed = stampAccepted.run(msToSqlite(connection.createdAt), connection.memberUrn, matches.targetId).changes;
            if (changed === 1) {
              stamped++;
              console.log(`[sync-accepted] Accepted via ${matches.matchedBy}: ${matches.targetId} (${connection.vanity})`);
              try { autoAdvanceTargetByTrigger(db, matches.targetId, "connected"); } catch { /* non-blocking */ }
            }
          } else if (matches.conflictTargetIds.length > 0) {
            console.warn(`[sync-accepted] Ambiguous vanity ${connection.vanity}; refusing targets ${matches.conflictTargetIds.join(",")}`);
          }
        } else if (connection.memberUrn) {
          const matches = matchAcceptedConnection(connection, pendingTargets);
          if (matches.targetId) {
            matchedTargets++;
            const changed = stampAccepted.run(msToSqlite(connection.createdAt), connection.memberUrn, matches.targetId).changes;
            if (changed === 1) {
              stamped++;
              try { autoAdvanceTargetByTrigger(db, matches.targetId, "connected"); } catch { /* non-blocking */ }
            }
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
          AND (t.connected_at IS NULL OR t.connected_at < datetime('now', '-7 days'))
          AND t.linkedin_url LIKE '%/in/%'
          AND NOT EXISTS (
            SELECT 1
            FROM run_profiles other_rp
            JOIN runs other_r ON other_r.id = other_rp.run_id
            WHERE other_rp.target_id = t.id
              AND other_r.account_id != ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM run_profile_tracks rpt
            JOIN workflow_steps ws ON ws.id = rpt.current_step_id
            WHERE rpt.run_profile_id = rp.id
              AND rpt.status = 'active'
              AND ws.step_type = 'message'
          )
      `).all(accountId, accountId) as Array<{ id: string; linkedin_url: string }>;
      const unmark = db.prepare("UPDATE targets SET degree = NULL, connected_at = NULL WHERE id = ?");
      db.transaction(() => {
        for (const target of degreeOne) {
          const vanity = canonicalLinkedInVanity(target.linkedin_url);
          const normVanity = normalizeVanitySlug(vanity);
          const isSeen = (vanity && seenVanities.has(vanity)) || (normVanity && seenNormalizedVanities.has(normVanity));
          if (vanity && !isSeen) {
            unmark.run(target.id);
            unmarked++;
          }
        }
      })();
    }

    if (leaseLost) throw new AcceptedSyncLeaseLostError();
    const scanComplete = reachedFloor && !apiError;
    if (scanComplete) {
      // Advance all freshness metadata together. A partial scan must never move
      // the cursor because doing so can permanently hide an accepted contact.
      db.transaction(() => {
        if (newestSeen !== null) {
          db.prepare("UPDATE accounts SET connections_synced_through_ms = ? WHERE id = ?").run(newestSeen, accountId);
        }
        if (declaredTotal !== null) {
          db.prepare("UPDATE accounts SET li_connections = ? WHERE id = ?").run(declaredTotal, accountId);
        }
        db.prepare("UPDATE accounts SET accepted_sync_at = datetime('now') WHERE id = ?").run(accountId);
      })();
      completed = true;
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
    if (error instanceof AcceptedSyncLeaseLostError) {
      console.warn("[sync-accepted] Account lease was lost; stopping this pass before further writes");
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
        reason: "in_progress",
      };
    }
    if (error instanceof LinkedInConnectionsApiAuthorizationError) {
      const probe = page ? await probeLinkedInAuthenticationWall(page) : "indeterminate";
      if (probe === "wall") {
        // Positively logged out: flag it so the runner stops working this
        // account instead of re-entering the 401 loop on the next pass.
        console.warn(`[sync-accepted] Authentication wall confirmed after API HTTP ${error.status} — flagging account for reauthentication`);
        sessionWall = true;
        return {
          success: false,
          partial: false,
          stamped,
          unmarked,
          pages,
          connectionsRead,
          pendingTargets: pendingTargets.length,
          matchedTargets,
          declaredTotal,
          reason: "auth_wall",
        };
      }
      if (probe === "indeterminate") {
        console.warn(`[sync-accepted] Connections API returned HTTP ${error.status} and the auth probe was inconclusive — leaving the session untouched and retrying later`);
      } else {
        console.warn(`[sync-accepted] Connections API returned HTTP ${error.status}, but the feed session remains authenticated`);
      }
      try {
        db.prepare("UPDATE accounts SET accepted_sync_at = datetime('now') WHERE id = ?").run(accountId);
      } catch { /* ignore */ }
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
        reason: "api_error",
      };
    }
    if (error instanceof LinkedInAuthenticationError) {
      sessionWall = true;
      console.warn(`[sync-accepted] Authentication wall: ${error.message}`);
      return {
        success: false,
        partial: false,
        stamped,
        unmarked,
        pages,
        connectionsRead,
        pendingTargets: pendingTargets.length,
        matchedTargets,
        declaredTotal,
        reason: "auth_wall",
      };
    }
    console.warn(`[sync-accepted] Failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      db.prepare("UPDATE accounts SET accepted_sync_at = datetime('now') WHERE id = ?").run(accountId);
    } catch { /* ignore */ }
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
    clearInterval(leaseHeartbeat);
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
      if (completed) {
        try { await saveSessionState(accountId); } catch { /* ignore */ }
      }
    }
    // sessionWall means LinkedIn positively refused this session (redirect to a
    // login/checkpoint URL, or a confirmed wall probe). Act on it: without this
    // the account keeps its is_authenticated=1 flag and every later pass
    // re-enters the same 401/authwall loop. Only a CONFIRMED wall gets here —
    // an inconclusive probe deliberately leaves the session alone.
    if (sessionWall) {
      try { await markNeedsReauth(accountId); } catch { /* best effort */ }
    }
    if (leaseOwner) {
      try { releaseRuntimeLease(db, leaseKey, leaseOwner); } catch { /* lease expires safely */ }
    }
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
  let csrf = "";
  try {
    const cookies = await page.context().cookies("https://www.linkedin.com");
    csrf = linkedinCsrfFromCookies(cookies) ?? "";
  } catch (error) {
    console.warn(`[sync-accepted] Could not read context cookies: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!csrf) {
    console.warn("[sync-accepted] JSESSIONID cookie is missing");
    return null;
  }

  let payloadResult: { status: number; payload: import("./connection-reconciliation").VoyagerConnectionsPayload | null } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      payloadResult = (await page.evaluate(
        async ({ start, count, decoration, csrf }) => {
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
            if (response.status === 401 || response.status === 403) {
              return { status: response.status, payload: null };
            }
            if (!response.ok) return { status: response.status, payload: null };
            const text = await response.text();
            if (!text) return { status: response.status, payload: null };
            return { status: response.status, payload: JSON.parse(text) };
          } catch {
            return { status: 0, payload: null };
          }
        },
        { start, count, decoration: DECORATION, csrf }
      )) as { status: number; payload: import("./connection-reconciliation").VoyagerConnectionsPayload | null };
      break;
    } catch (evalErr) {
      const msg = evalErr instanceof Error ? evalErr.message : String(evalErr);
      if (attempt < 2 && (msg.includes("destroyed") || msg.includes("navigat") || msg.includes("Target closed"))) {
        await page.waitForTimeout(2000);
        continue;
      }
      console.warn(`[sync-accepted] fetchConnectionsPage evaluate error: ${msg}`);
      return null;
    }
  }

  if (!payloadResult) return null;

  if (payloadResult.status === 401 || payloadResult.status === 403) {
    throw new LinkedInConnectionsApiAuthorizationError(payloadResult.status);
  }
  if (!payloadResult.payload || typeof payloadResult.payload !== "object") return null;
  const payload = payloadResult.payload as import("./connection-reconciliation").VoyagerConnectionsPayload;
  if (!payload.data && !Array.isArray(payload.included)) return null;
  const parsed = parseVoyagerConnections(payload);
  return { connections: parsed.connections, referencedElements: parsed.referencedElements };
}
