import type Database from "better-sqlite3";
import type { Page } from "playwright";
import { createHash } from "node:crypto";
import {
  captureSdrInboundMessage,
  type CapturedInboundMessage,
} from "../sdr-agent/repository";
import type { SdrInboundMessage } from "../sdr-agent/contracts";

interface SessionRuntime {
  getSessionPage(accountId: string): Promise<Page>;
  markNeedsReauth(accountId: string): Promise<void>;
  saveSessionState(accountId: string): Promise<void>;
}

function getDefaultDb(): Database.Database {
  // Keep database and browser initialization lazy so pure capture fixtures can
  // run against an injected SQLite connection without Linki process startup.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../db").getDb() as Database.Database;
}

function getSessionRuntime(): SessionRuntime {
  // Keep the browser dependency lazy: pure normalization/capture tests must not
  // initialize Playwright or a Linki session.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./session") as SessionRuntime;
}

const ADAPTER_VERSION = "2a-contract";
const MAX_EVENT_ID_LENGTH = 512;
const LINKEDIN_PROFILE_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);
const FSD_PROFILE_URN = /^urn:li:fsd_profile:[^\s]+$/;
const AUTH_WALL_PATTERN = /\/login|\/authwall|\/checkpoint|\/uas\//i;

export type LinkedInInboxDirection = "inbound" | "outbound" | "system";

/**
 * Provider-neutral output from an observation source. This deliberately does
 * not describe LinkedIn's wire format: that contract remains unverified until
 * a controlled, authorized session is captured and documented.
 */
export interface LinkedInInboxObservation {
  externalThreadId: string;
  externalMessageId: string;
  direction: string;
  body: string;
  receivedAt: string | number;
  senderExternalId?: string | null;
  senderName?: string | null;
  senderMessagingUrn?: string | null;
  senderProfileUrl?: string | null;
  providerEventId?: string | null;
  rawKind?: string | null;
}

export interface LinkedInInboxObservationSource {
  observe(page: Page): Promise<readonly LinkedInInboxObservation[]>;
}

export type LinkedInInboxSkipReason =
  | "outbound_or_system"
  | "invalid_observation"
  | "invalid_identity"
  | "unmatched_target"
  | "ambiguous_target"
  | "identity_conflict"
  | "wrong_account_ownership";

export interface LinkedInInboxSkippedObservation {
  externalThreadId?: string;
  externalMessageId?: string;
  reason: LinkedInInboxSkipReason;
}

export interface LinkedInInboxCaptureResult {
  captured: number;
  duplicates: number;
  skipped: LinkedInInboxSkippedObservation[];
}

export class LinkedInInboxAccountError extends Error {
  constructor(
    message: string,
    readonly reason: "unknown_account" | "unauthenticated_account",
  ) {
    super(message);
    this.name = "LinkedInInboxAccountError";
  }
}

export class LinkedInInboxAuthenticationError extends Error {
  constructor(readonly url: string) {
    super("LinkedIn session requires re-authentication");
    this.name = "LinkedInInboxAuthenticationError";
  }
}

interface ScopedTarget {
  id: string;
  messaging_urn: string | null;
  linkedin_url: string | null;
}

interface NormalizedObservation {
  observation: LinkedInInboxObservation;
  externalThreadId: string;
  externalMessageId: string;
  body: string;
  receivedAt: string;
  senderExternalId: string | null;
  senderName: string | null;
  senderMessagingUrn: string | null;
  senderVanity: string | null;
}

interface TargetResolution {
  targetId: string;
  identityMode: "messaging_urn" | "profile_url" | "messaging_urn+profile_url";
}

export interface LinkedInInboxSyncOptions {
  accountId: string;
  source: LinkedInInboxObservationSource;
  db?: Database.Database;
  pageFactory?: (accountId: string) => Promise<Page>;
  saveState?: (accountId: string) => Promise<void>;
  markReauth?: (accountId: string) => Promise<void>;
}

function trimNullable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n").trim();
  return body || null;
}

function normalizeReceivedAt(value: unknown): string | null {
  // Epoch timestamps are intentionally not accepted until a real LinkedIn
  // fixture proves that format. Date-only and timezone-less values are also
  // ambiguous and must not enter the conversation timeline.
  if (typeof value !== "string") return null;
  const input = value.trim();
  const match = input.match(
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeProfileVanity(value: string | null | undefined): string | null {
  const input = trimNullable(value);
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || !LINKEDIN_PROFILE_HOSTS.has(url.hostname.toLowerCase())
    || url.port
    || url.username
    || url.password
  ) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "in") return null;
  try {
    const vanity = decodeURIComponent(parts[1]).trim().toLowerCase();
    return vanity && /^[^\s/?#]+$/.test(vanity) ? vanity : null;
  } catch {
    return null;
  }
}

function normalizeTargetVanity(value: string | null): string | null {
  return normalizeProfileVanity(value);
}

function isValidMessagingUrn(value: string): boolean {
  return FSD_PROFILE_URN.test(value);
}

function observationKey(observation: unknown): {
  externalThreadId?: string;
  externalMessageId?: string;
} {
  if (!observation || typeof observation !== "object") return {};
  const value = observation as { externalThreadId?: unknown; externalMessageId?: unknown };
  return {
    externalThreadId: typeof value.externalThreadId === "string"
      ? value.externalThreadId.trim().slice(0, 1024) || undefined
      : undefined,
    externalMessageId: typeof value.externalMessageId === "string"
      ? value.externalMessageId.trim().slice(0, 1024) || undefined
      : undefined,
  };
}

function normalizeObservation(
  value: unknown,
): NormalizedObservation | { reason: LinkedInInboxSkipReason } {
  if (!value || typeof value !== "object") return { reason: "invalid_observation" };
  const observation = value as LinkedInInboxObservation;
  if (observation.direction !== "inbound") {
    return {
      reason: observation.direction === "outbound" || observation.direction === "system"
        ? "outbound_or_system"
        : "invalid_observation",
    };
  }

  const externalThreadId = trimNullable(observation.externalThreadId);
  const externalMessageId = trimNullable(observation.externalMessageId);
  const body = normalizeBody(observation.body);
  const receivedAt = normalizeReceivedAt(observation.receivedAt);
  if (!externalThreadId || !externalMessageId || !body || !receivedAt) {
    return { reason: "invalid_observation" };
  }
  if (externalThreadId.length > 1024 || externalMessageId.length > 1024 || body.length > 100_000) {
    return { reason: "invalid_observation" };
  }

  const senderMessagingUrn = trimNullable(observation.senderMessagingUrn);
  if (senderMessagingUrn && !isValidMessagingUrn(senderMessagingUrn)) {
    return { reason: "invalid_identity" };
  }

  const profileInput = trimNullable(observation.senderProfileUrl);
  const senderVanity = profileInput ? normalizeProfileVanity(profileInput) : null;
  if (profileInput && !senderVanity) return { reason: "invalid_identity" };
  if (!senderMessagingUrn && !senderVanity) return { reason: "invalid_identity" };

  const senderExternalId = trimNullable(observation.senderExternalId);
  const senderName = trimNullable(observation.senderName);
  if (senderExternalId && senderExternalId.length > 1024) return { reason: "invalid_observation" };
  if (senderName && senderName.length > 500) return { reason: "invalid_observation" };

  return {
    observation,
    externalThreadId,
    externalMessageId,
    body,
    receivedAt,
    senderExternalId,
    senderName,
    senderMessagingUrn,
    senderVanity,
  };
}

function accountIsReady(db: Database.Database, accountId: string): void {
  if (!accountId.trim()) {
    throw new LinkedInInboxAccountError("LinkedIn account id cannot be empty", "unknown_account");
  }
  const account = db.prepare("SELECT id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number | null }
    | undefined;
  if (!account) throw new LinkedInInboxAccountError(`LinkedIn account ${accountId} not found`, "unknown_account");
  if (account.is_authenticated !== 1) {
    throw new LinkedInInboxAccountError(`LinkedIn account ${accountId} is not authenticated`, "unauthenticated_account");
  }
}

function loadScopedTargets(db: Database.Database, accountId: string): ScopedTarget[] {
  return db.prepare(`
    SELECT DISTINCT t.id, t.messaging_urn, t.linkedin_url
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN runs r ON r.id = rp.run_id
    WHERE r.account_id = ?
  `).all(accountId) as ScopedTarget[];
}

function loadAllTargets(db: Database.Database): ScopedTarget[] {
  return db.prepare("SELECT id, messaging_urn, linkedin_url FROM targets").all() as ScopedTarget[];
}

function idsForMessagingUrn(targets: ScopedTarget[], urn: string): string[] {
  return [...new Set(targets.filter((target) => target.messaging_urn === urn).map((target) => target.id))];
}

function idsForVanity(targets: ScopedTarget[], vanity: string): string[] {
  return [...new Set(targets.filter((target) => normalizeTargetVanity(target.linkedin_url) === vanity).map((target) => target.id))];
}

function resolveTarget(
  db: Database.Database,
  accountId: string,
  normalized: NormalizedObservation,
): TargetResolution | { reason: LinkedInInboxSkipReason } {
  const scoped = loadScopedTargets(db, accountId);
  const allTargets = loadAllTargets(db);
  const urnIds = normalized.senderMessagingUrn ? idsForMessagingUrn(scoped, normalized.senderMessagingUrn) : [];
  const vanityIds = normalized.senderVanity ? idsForVanity(scoped, normalized.senderVanity) : [];
  const globalUrnIds = normalized.senderMessagingUrn ? idsForMessagingUrn(allTargets, normalized.senderMessagingUrn) : [];
  const globalVanityIds = normalized.senderVanity ? idsForVanity(allTargets, normalized.senderVanity) : [];

  if (normalized.senderMessagingUrn && normalized.senderVanity) {
    if (urnIds.length > 1 || vanityIds.length > 1) return { reason: "ambiguous_target" };
    if (urnIds.length === 1 && vanityIds.length === 1 && urnIds[0] !== vanityIds[0]) {
      return { reason: "identity_conflict" };
    }
    if (urnIds.length === 1 && vanityIds.length === 0) {
      return globalVanityIds.length > 0 ? { reason: "identity_conflict" } : { reason: "unmatched_target" };
    }
    if (urnIds.length === 0 && vanityIds.length === 1) {
      return globalUrnIds.length > 0 ? { reason: "identity_conflict" } : { reason: "unmatched_target" };
    }
    if (urnIds.length === 0 || vanityIds.length === 0) {
      return globalUrnIds.length > 0 || globalVanityIds.length > 0
        ? { reason: "wrong_account_ownership" }
        : { reason: "unmatched_target" };
    }
    return { targetId: urnIds[0], identityMode: "messaging_urn+profile_url" };
  }

  if (normalized.senderMessagingUrn) {
    if (urnIds.length > 1) return { reason: "ambiguous_target" };
    if (urnIds.length === 1) return { targetId: urnIds[0], identityMode: "messaging_urn" };
    if (globalUrnIds.length > 0) return { reason: "wrong_account_ownership" };
    return { reason: "unmatched_target" };
  }

  if (vanityIds.length > 1) return { reason: "ambiguous_target" };
  if (vanityIds.length === 1) return { targetId: vanityIds[0], identityMode: "profile_url" };
  if (globalVanityIds.length > 0) return { reason: "wrong_account_ownership" };
  return { reason: "unmatched_target" };
}

function safeMetadata(
  normalized: NormalizedObservation,
  identityMode: TargetResolution["identityMode"],
): Record<string, string> {
  const metadata: Record<string, string> = {
    adapter_version: ADAPTER_VERSION,
    identity_mode: identityMode,
  };
  const rawKind = trimNullable(normalized.observation.rawKind);
  if (rawKind && rawKind.length <= 100 && /^[\w.:-]+$/.test(rawKind)) metadata.raw_kind = rawKind;
  return metadata;
}

function boundedEventId(accountId: string, threadId: string, messageId: string, providerEventId: string | null): string {
  const candidate = providerEventId
    ? `linkedin:${accountId}:provider:${providerEventId}`
    : `linkedin:${accountId}:${threadId}:${messageId}`;
  if (candidate.length <= MAX_EVENT_ID_LENGTH) return candidate;
  const digest = createHash("sha256").update(candidate, "utf8").digest("hex");
  return `linkedin:event:${digest}`;
}

function toSdrEvent(
  accountId: string,
  targetId: string,
  normalized: NormalizedObservation,
  identityMode: TargetResolution["identityMode"],
): SdrInboundMessage {
  const providerEventId = trimNullable(normalized.observation.providerEventId);
  const eventId = boundedEventId(accountId, normalized.externalThreadId, normalized.externalMessageId, providerEventId);
  return {
    eventId,
    channel: "linkedin",
    targetId,
    accountId,
    emailAccountId: null,
    externalThreadId: normalized.externalThreadId,
    externalMessageId: normalized.externalMessageId,
    senderExternalId: normalized.senderExternalId,
    senderName: normalized.senderName,
    body: normalized.body,
    receivedAt: normalized.receivedAt,
    metadata: safeMetadata(normalized, identityMode),
  };
}

function repositoryErrorReason(error: unknown): LinkedInInboxSkipReason {
  if (error instanceof Error && /different target|target/i.test(error.message)) return "identity_conflict";
  return "invalid_observation";
}

/**
 * Normalizes and captures observed inbound records for one explicit LinkedIn
 * slot. No target or legacy inbox state is inferred or updated here.
 */
export function captureLinkedInInboxObservations(
  db: Database.Database,
  accountId: string,
  observations: readonly unknown[],
): LinkedInInboxCaptureResult {
  accountIsReady(db, accountId);
  const result: LinkedInInboxCaptureResult = { captured: 0, duplicates: 0, skipped: [] };

  for (const value of observations) {
    const key = observationKey(value);
    const normalized = normalizeObservation(value);
    if ("reason" in normalized) {
      result.skipped.push({ ...key, reason: normalized.reason });
      continue;
    }

    const resolution = resolveTarget(db, accountId, normalized);
    if ("reason" in resolution) {
      result.skipped.push({ ...key, reason: resolution.reason });
      continue;
    }

    try {
      const captured: CapturedInboundMessage = captureSdrInboundMessage(
        db,
        toSdrEvent(accountId, resolution.targetId, normalized, resolution.identityMode),
      );
      if (captured.duplicate) result.duplicates++;
      else result.captured++;
    } catch (error) {
      result.skipped.push({ ...key, reason: repositoryErrorReason(error) });
    }
  }

  return result;
}

export function isLinkedInAuthenticationWall(url: string): boolean {
  return AUTH_WALL_PATTERN.test(url);
}

/**
 * Explicit read-only session wrapper. The observation source is injected so a
 * real LinkedIn wire parser cannot be introduced before its contract is proven.
 */
export async function syncLinkedInInboxReadOnly(
  options: LinkedInInboxSyncOptions,
): Promise<LinkedInInboxCaptureResult> {
  const db = options.db ?? getDefaultDb();
  accountIsReady(db, options.accountId);
  const session = (!options.pageFactory || !options.saveState || !options.markReauth)
    ? getSessionRuntime()
    : null;
  const openPage = options.pageFactory ?? ((accountId: string) => session!.getSessionPage(accountId));
  const persistState = options.saveState ?? ((accountId: string) => session!.saveSessionState(accountId));
  const reauth = options.markReauth ?? ((accountId: string) => session!.markNeedsReauth(accountId));
  const page = await openPage(options.accountId);
  let wallUrl: string | null = null;

  try {
    const currentUrl = page.url();
    if (isLinkedInAuthenticationWall(currentUrl)) {
      wallUrl = currentUrl;
      throw new LinkedInInboxAuthenticationError(currentUrl);
    }

    let observations: readonly LinkedInInboxObservation[];
    try {
      observations = await options.source.observe(page);
    } catch (error) {
      const url = page.url();
      if (isLinkedInAuthenticationWall(url)) {
        wallUrl = url;
        throw new LinkedInInboxAuthenticationError(url);
      }
      throw error;
    }

    const afterObserveUrl = page.url();
    if (isLinkedInAuthenticationWall(afterObserveUrl)) {
      wallUrl = afterObserveUrl;
      throw new LinkedInInboxAuthenticationError(afterObserveUrl);
    }
    if (!Array.isArray(observations)) throw new Error("LinkedIn inbox observation source returned a non-array");

    const result = captureLinkedInInboxObservations(db, options.accountId, observations);
    await persistState(options.accountId);
    return result;
  } finally {
    try {
      await page.close();
    } finally {
      if (wallUrl) {
        await reauth(options.accountId);
      }
    }
  }
}
