import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Page } from "playwright";
import { getDb } from "@/lib/db";
import { getSessionPage, markNeedsReauth, saveSessionState } from "@/lib/linkedin/session";
import {
  canonicalLinkedInVanity,
} from "@/lib/linkedin/connection-reconciliation";
import type { LinkedInInboxObservation } from "./inbox-sync";

export interface CampaignTargetScope {
  targetId: string;
  accountId: string;
  runId: string;
  workflowId: string | null;
  messagingUrn: string | null;
  linkedinUrl: string | null;
  outboundAt: string;
}

export interface CampaignInboxObservation extends LinkedInInboxObservation {
  campaignOutboundObservedAt?: string | null;
  campaignRunId?: string | null;
  campaignWorkflowId?: string | null;
}

export type CampaignInboxSkipReason =
  | "invalid_observation"
  | "not_campaign_message"
  | "unmatched_target"
  | "ambiguous_target"
  | "identity_conflict"
  | "wrong_account_ownership"
  | "stale_message"
  | "duplicate";

export interface CampaignInboxCaptureResult {
  captured: number;
  duplicates: number;
  skipped: Array<{ externalThreadId?: string; externalMessageId?: string; reason: CampaignInboxSkipReason }>;
}

export interface CampaignInboxSyncResult extends CampaignInboxCaptureResult {
  success: boolean;
  partial: boolean;
  accountId: string;
  conversationsReviewed: number;
  campaignCandidates: number;
  inboundObserved: number;
  reason?: "disabled" | "contract_unverified" | "account_missing" | "unauthenticated" | "auth_wall" | "api_error" | "contract_mismatch" | "invalid_response";
}

export interface CampaignInboxSyncOptions {
  db?: Database.Database;
  pageFactory?: (accountId: string) => Promise<Page>;
  saveState?: (accountId: string) => Promise<void>;
  markReauth?: (accountId: string) => Promise<void>;
  allowWhenSchedulerDisabled?: boolean;
  contractVersion?: string;
}

export function campaignInboxSchedulerEnabled(): boolean {
  return process.env.LINKEDIN_CAMPAIGN_INBOX_SYNC_ENABLED === "true";
}

export function campaignInboxContractVersion(): string | null {
  const version = process.env.LINKEDIN_INBOX_CONTRACT_VERSION?.trim();
  return process.env.LINKEDIN_INBOX_CONTRACT_VERIFIED === "true" && version ? version : null;
}

export function listCampaignInboxAccountIds(db: Database.Database = getDb()): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT r.account_id AS account_id
    FROM logs l
    JOIN runs r ON r.id = l.run_id
    JOIN accounts a ON a.id = r.account_id
    WHERE a.is_authenticated = 1
      AND (l.message LIKE 'Message sent%' OR l.message LIKE 'InMail sent%')
    UNION
    SELECT DISTINCT r.account_id AS account_id
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN runs r ON r.id = rp.run_id
    JOIN accounts a ON a.id = r.account_id
    WHERE a.is_authenticated = 1
      AND t.message_sent_at IS NOT NULL
    ORDER BY account_id
  `).all() as Array<{ account_id: string }>;
  return rows.map((row) => row.account_id);
}

export function loadCampaignTargetScopes(
  db: Database.Database,
  accountId: string,
): CampaignTargetScope[] {
  const rows = db.prepare(`
    SELECT
      t.id AS targetId,
      r.account_id AS accountId,
      r.id AS runId,
      r.workflow_id AS workflowId,
      t.messaging_urn AS messagingUrn,
      t.linkedin_url AS linkedinUrl,
      COALESCE(
        MAX(CASE WHEN l.message LIKE 'Message sent%' OR l.message LIKE 'InMail sent%' THEN l.created_at END),
        t.message_sent_at,
        rp.created_at
      ) AS outboundAt
    FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    JOIN targets t ON t.id = rp.target_id
    LEFT JOIN logs l ON l.run_id = r.id AND l.target_id = t.id
    WHERE r.account_id = ?
      AND (
        t.message_sent_at IS NOT NULL
        OR l.message LIKE 'Message sent%'
        OR l.message LIKE 'InMail sent%'
      )
    GROUP BY t.id, r.account_id, r.id, r.workflow_id
    ORDER BY outboundAt DESC
  `).all(accountId) as CampaignTargetScope[];

  // A target-level LinkedIn URL/URN cannot safely identify which slot owns a
  // reply when the same target was messaged from multiple accounts. Exclude all
  // such targets rather than showing a reply under the wrong campaign.
  const accountCount = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!accountCount.has(row.targetId)) accountCount.set(row.targetId, new Set());
    accountCount.get(row.targetId)!.add(row.accountId);
  }
  const ambiguousTargets = new Set(
    [...accountCount.entries()]
      .filter(([, accounts]) => accounts.size > 1)
      .map(([targetId]) => targetId),
  );
  return rows.filter((row) => !ambiguousTargets.has(row.targetId));
}

function observationKey(value: unknown): { externalThreadId?: string; externalMessageId?: string } {
  if (!value || typeof value !== "object") return {};
  const item = value as { externalThreadId?: unknown; externalMessageId?: unknown };
  return {
    externalThreadId: typeof item.externalThreadId === "string" ? item.externalThreadId.slice(0, 1024) : undefined,
    externalMessageId: typeof item.externalMessageId === "string" ? item.externalMessageId.slice(0, 1024) : undefined,
  };
}

function parseTimestamp(value: string): number {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

function normalizeUrn(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function findScope(
  observation: CampaignInboxObservation,
  scopes: readonly CampaignTargetScope[],
): { scope: CampaignTargetScope; identityMode: "messaging_urn" | "profile_url" | "messaging_urn+profile_url" } | { reason: CampaignInboxSkipReason } {
  const senderUrn = normalizeUrn(observation.senderMessagingUrn);
  const senderVanity = canonicalLinkedInVanity(observation.senderProfileUrl);
  if (!senderUrn && !senderVanity) return { reason: "invalid_observation" };

  const urnMatches = senderUrn ? scopes.filter((scope) => normalizeUrn(scope.messagingUrn) === senderUrn) : [];
  const vanityMatches = senderVanity
    ? scopes.filter((scope) => canonicalLinkedInVanity(scope.linkedinUrl) === senderVanity)
    : [];

  if (urnMatches.length > 1 || vanityMatches.length > 1) return { reason: "ambiguous_target" };
  if (urnMatches.length === 1 && vanityMatches.length === 1) {
    if (urnMatches[0].targetId !== vanityMatches[0].targetId) return { reason: "identity_conflict" };
    return { scope: urnMatches[0], identityMode: "messaging_urn+profile_url" };
  }
  if (urnMatches.length === 1) {
    if (vanityMatches.length === 0 && senderVanity && scopes.some((scope) => canonicalLinkedInVanity(scope.linkedinUrl) === senderVanity)) {
      return { reason: "identity_conflict" };
    }
    return { scope: urnMatches[0], identityMode: "messaging_urn" };
  }
  if (vanityMatches.length === 1) {
    if (senderUrn && scopes.some((scope) => normalizeUrn(scope.messagingUrn) === senderUrn)) {
      return { reason: "identity_conflict" };
    }
    return { scope: vanityMatches[0], identityMode: "profile_url" };
  }
  return { reason: "unmatched_target" };
}

/**
 * Persists only inbound observations that a verified source has proven belong
 * to a campaign thread. Rejected observations never write a body, event, or
 * legacy target reply field.
 */
export function captureCampaignInboxObservations(
  db: Database.Database,
  accountId: string,
  observations: readonly CampaignInboxObservation[],
  scopes = loadCampaignTargetScopes(db, accountId),
): CampaignInboxCaptureResult {
  const result: CampaignInboxCaptureResult = { captured: 0, duplicates: 0, skipped: [] };
  const insert = db.prepare(`
    INSERT INTO linkedin_inbox_messages (
      id, account_id, target_id, run_id, workflow_id,
      external_thread_id, external_message_id, direction,
      sender_external_id, sender_name, body, sent_at, identity_mode, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, external_thread_id, external_message_id) DO NOTHING
  `);
  const updateReply = db.prepare(`
    UPDATE targets
    SET
      last_replied_at = ?,
      last_replied_account_id = ?
    WHERE id = ?
      AND (last_replied_at IS NULL OR strftime('%s', last_replied_at) < strftime('%s', ?))
  `);
  const stopTracks = db.prepare(`
    UPDATE run_profile_tracks
    SET state = 'skipped', next_step_at = NULL, error_message = 'Lead replied via LinkedIn'
    WHERE state NOT IN ('completed', 'failed', 'skipped')
      AND run_profile_id IN (
        SELECT rp.id
        FROM run_profiles rp
        JOIN runs r ON r.id = rp.run_id
        WHERE rp.target_id = ? AND r.account_id = ?
      )
  `);

  for (const observation of observations) {
    const key = observationKey(observation);
    const receivedAtMs = typeof observation.receivedAt === "string" ? parseTimestamp(observation.receivedAt) : NaN;
    if (
      observation.direction !== "inbound"
      || typeof observation.body !== "string"
      || !observation.body.trim()
      || !Number.isFinite(receivedAtMs)
      || observation.body.length > 100_000
      || !observation.externalThreadId
      || !observation.externalMessageId
    ) {
      result.skipped.push({ ...key, reason: "invalid_observation" });
      continue;
    }

    const match = findScope(observation, scopes);
    if ("reason" in match) {
      result.skipped.push({ ...key, reason: match.reason });
      continue;
    }

    const sentAt = new Date(receivedAtMs).toISOString();
    const metadata = JSON.stringify({
      source: "campaign-inbox",
      campaign_outbound_at: match.scope.outboundAt,
      provider_event_id: observation.providerEventId ?? null,
    });
    const captured = db.transaction(() => {
      const inserted = insert.run(
        randomUUID(),
        accountId,
        match.scope.targetId,
        match.scope.runId,
        match.scope.workflowId,
        observation.externalThreadId,
        observation.externalMessageId,
        observation.senderExternalId ?? null,
        observation.senderName ?? null,
        observation.body.trim(),
        sentAt,
        match.identityMode,
        metadata,
      );
      if (inserted.changes !== 1) return false;
      updateReply.run(sentAt, accountId, match.scope.targetId, sentAt);
      stopTracks.run(match.scope.targetId, accountId);
      return true;
    })();
    if (captured) result.captured++;
    else {
      result.duplicates++;
      result.skipped.push({ ...key, reason: "duplicate" });
    }
  }
  return result;
}

export function shouldSyncLinkedInCampaignInbox(
  accountId: string,
  db: Database.Database = getDb(),
): boolean {
  const row = db.prepare("SELECT linkedin_inbox_synced_at FROM accounts WHERE id = ?").get(accountId) as
    | { linkedin_inbox_synced_at: string | null }
    | undefined;
  if (!row?.linkedin_inbox_synced_at) return true;
  return Date.now() - parseTimestamp(row.linkedin_inbox_synced_at) >= 15 * 60 * 1000;
}

export async function syncLinkedInCampaignInbox(
  accountId: string,
  options: CampaignInboxSyncOptions = {},
): Promise<CampaignInboxSyncResult> {
  const db = options.db ?? getDb();
  const base = {
    accountId,
    captured: 0,
    duplicates: 0,
    skipped: [] as CampaignInboxSyncResult["skipped"],
    success: false,
    partial: false,
    conversationsReviewed: 0,
    campaignCandidates: 0,
    inboundObserved: 0,
  };
  if (!options.allowWhenSchedulerDisabled && !campaignInboxSchedulerEnabled()) return { ...base, reason: "disabled" };
  const contractVersion = options.contractVersion ?? campaignInboxContractVersion();
  if (!contractVersion) return { ...base, reason: "contract_unverified" };

  const account = db.prepare("SELECT id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number }
    | undefined;
  if (!account) return { ...base, reason: "account_missing" };
  if (account.is_authenticated !== 1) return { ...base, reason: "unauthenticated" };

  const scopes = loadCampaignTargetScopes(db, accountId);
  if (scopes.length === 0) return { ...base, success: true };

  const { CampaignLinkedInMessagingSource } = await import("./campaign-inbox-source");
  const source = new CampaignLinkedInMessagingSource(scopes, { contractVersion });
  const page = options.pageFactory ? await options.pageFactory(accountId) : await getSessionPage(accountId);
  let wall = false;
  try {
    if (!page.url().includes("linkedin.com")) {
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    const currentUrl = page.url();
    if (/\/login|\/authwall|\/checkpoint|\/uas\//i.test(currentUrl)) {
      wall = true;
      return { ...base, partial: true, reason: "auth_wall" };
    }
    const observations = await source.observe(page);
    const capture = captureCampaignInboxObservations(db, accountId, observations, scopes);
    const result = {
      ...base,
      ...capture,
      success: true,
      conversationsReviewed: source.conversationsReviewed,
      campaignCandidates: source.campaignCandidates,
      inboundObserved: observations.length,
    };
    db.prepare("UPDATE accounts SET linkedin_inbox_synced_at = datetime('now'), linkedin_inbox_sync_error = NULL, linkedin_inbox_contract_version = ? WHERE id = ?").run(contractVersion, accountId);
    return result;
  } catch (error) {
    const reason = error instanceof CampaignInboxSourceError ? error.reason : "invalid_response";
    db.prepare("UPDATE accounts SET linkedin_inbox_sync_error = ? WHERE id = ?").run(reason, accountId);
    return { ...base, partial: true, reason };
  } finally {
    let url = "";
    try { url = page.url(); } catch { /* page gone */ }
    try { await page.close(); } catch { /* ignore */ }
    if (wall || /\/login|\/authwall|\/checkpoint|\/uas\//i.test(url)) {
      try { await (options.markReauth ?? markNeedsReauth)(accountId); } catch { /* ignore */ }
    } else {
      try { await (options.saveState ?? saveSessionState)(accountId); } catch { /* ignore */ }
    }
  }
}

export class CampaignInboxSourceError extends Error {
  constructor(
    message: string,
    readonly reason: NonNullable<CampaignInboxSyncResult["reason"]>,
  ) {
    super(message);
    this.name = "CampaignInboxSourceError";
  }
}

export interface CampaignInboxThreadMessage {
  externalThreadId: string;
  externalMessageId: string;
  direction: "inbound" | "outbound" | "system";
  body: string;
  sentAt: string;
  senderExternalId: string | null;
  senderName: string | null;
  metadataJson: string;
}

export function getCampaignLinkedInThread(
  db: Database.Database,
  targetId: string,
  accountId: string,
  externalThreadId: string,
): CampaignInboxThreadMessage[] | null {
  const owns = db.prepare(`
    SELECT 1
    FROM linkedin_inbox_messages m
    WHERE m.target_id = ? AND m.account_id = ? AND m.external_thread_id = ?
    LIMIT 1
  `).get(targetId, accountId, externalThreadId);
  if (!owns) return null;
  return db.prepare(`
    SELECT external_thread_id AS externalThreadId,
      external_message_id AS externalMessageId,
      direction, body, sent_at AS sentAt,
      sender_external_id AS senderExternalId,
      sender_name AS senderName,
      metadata_json AS metadataJson
    FROM linkedin_inbox_messages
    WHERE target_id = ? AND account_id = ? AND external_thread_id = ?
    ORDER BY sent_at ASC, id ASC
  `).all(targetId, accountId, externalThreadId) as CampaignInboxThreadMessage[];
}

export interface CampaignInboxEventSummary {
  accountId: string;
  targetId: string;
  runId: string | null;
  workflowId: string | null;
  externalThreadId: string;
  externalMessageId: string;
  body: string;
  sentAt: string;
}

export function getLatestCampaignLinkedInEvent(
  db: Database.Database,
  targetId: string,
  accountId?: string,
): CampaignInboxEventSummary | null {
  const accountFilter = accountId ? "AND m.account_id = ?" : "";
  const params = accountId ? [targetId, accountId] : [targetId];
  return (db.prepare(`
    SELECT account_id AS accountId, target_id AS targetId,
      run_id AS runId, workflow_id AS workflowId,
      external_thread_id AS externalThreadId,
      external_message_id AS externalMessageId,
      body, sent_at AS sentAt
    FROM linkedin_inbox_messages m
    WHERE m.target_id = ? ${accountFilter}
    ORDER BY datetime(m.sent_at) DESC, m.id DESC
    LIMIT 1
  `).get(...params) as CampaignInboxEventSummary | undefined) ?? null;
}

export function listLatestCampaignLinkedInEvents(
  db: Database.Database,
  accountId?: string,
): CampaignInboxEventSummary[] {
  const accountFilter = accountId ? "WHERE account_id = ?" : "";
  const params = accountId ? [accountId] : [];
  return db.prepare(`
    SELECT account_id AS accountId, target_id AS targetId,
      run_id AS runId, workflow_id AS workflowId,
      external_thread_id AS externalThreadId,
      external_message_id AS externalMessageId,
      body, sent_at AS sentAt
    FROM (
      SELECT m.*, ROW_NUMBER() OVER (
        PARTITION BY target_id ${accountId ? ", account_id" : ""}
        ORDER BY datetime(sent_at) DESC, id DESC
      ) AS row_num
      FROM linkedin_inbox_messages m
      ${accountFilter}
    ) ranked
    WHERE row_num = 1
  `).all(...params) as CampaignInboxEventSummary[];
}

export function campaignInboxErrorReason(error: unknown): CampaignInboxSyncResult["reason"] {
  if (error instanceof CampaignInboxSourceError) return error.reason;
  return "invalid_response";
}

export type { LinkedInInboxObservation };
