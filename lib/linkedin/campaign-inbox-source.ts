import type { Page } from "playwright";
import { canonicalLinkedInVanity } from "./connection-reconciliation";
import {
  CAMPAIGN_OUTBOUND_TOLERANCE_MS,
  CampaignInboxSourceError,
  parseCampaignTimestamp,
  type CampaignInboxObservation,
  type CampaignTargetScope,
} from "./campaign-inbox";

export const SUPPORTED_CAMPAIGN_INBOX_CONTRACT = "legacy-voyager-v1";
const CONVERSATION_ENDPOINT = "https://www.linkedin.com/voyager/api/messaging/conversations";
const PROFILE_ENDPOINT = "https://www.linkedin.com/voyager/api/me";
const PAGE_SIZE = 20;
const MAX_CONVERSATION_PAGES = 50;
const MAX_MESSAGE_PAGES = 10;
const AUTH_WALL = /\/login|\/authwall|\/checkpoint|\/uas\//i;

interface JsonResponse {
  status: number;
  url: string;
  body: unknown;
}

interface LegacyCollection {
  elements?: unknown[];
  included?: unknown[];
  paging?: { start?: number; count?: number; total?: number };
  data?: Record<string, unknown>;
}

export interface ParsedIdentity {
  profileUrn: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  name: string | null;
}

interface ParsedConversation {
  threadId: string;
  participant: ParsedIdentity;
}

export interface ParsedMessage {
  messageId: string;
  sender: ParsedIdentity;
  body: string;
  sentAt: string;
  isFromCurrentUser: boolean;
}

export interface CampaignMessageSelection {
  outbound: ParsedMessage;
  inbound: ParsedMessage[];
}

export function selectCampaignMessages(
  messages: readonly ParsedMessage[],
  campaignOutboundAt: string,
): CampaignMessageSelection | null {
  const campaignAt = parseCampaignTimestamp(campaignOutboundAt);
  if (!Number.isFinite(campaignAt)) return null;
  const outbound = messages
    .filter((message) => message.isFromCurrentUser)
    .sort((a, b) => parseCampaignTimestamp(a.sentAt) - parseCampaignTimestamp(b.sentAt))
    .find((message) => {
      const sentAt = parseCampaignTimestamp(message.sentAt);
      return Number.isFinite(sentAt)
        && sentAt >= campaignAt - CAMPAIGN_OUTBOUND_TOLERANCE_MS;
    });
  if (!outbound) return null;
  const outboundAt = parseCampaignTimestamp(outbound.sentAt);
  const inbound = messages.filter((message) => {
    if (message.isFromCurrentUser) return false;
    const sentAt = parseCampaignTimestamp(message.sentAt);
    return Number.isFinite(sentAt) && sentAt > outboundAt;
  });
  return { outbound, inbound };
}

interface CandidateConversation extends ParsedConversation {
  scope: CampaignTargetScope;
}

export interface CampaignMessagingSourceOptions {
  contractVersion: string;
  maxConversationPages?: number;
  maxMessagePages?: number;
}

export function extractLegacyCollection(payload: unknown): LegacyCollection | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    payload,
    root.data,
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>).data : null,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as LegacyCollection;
    if (Array.isArray(value.elements) || Array.isArray(value.included)) return value;
  }
  return null;
}

function entityUrn(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["entityUrn", "urn", "objectUrn", "profileUrn", "conversationUrn", "messageUrn"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const nested = entityUrn(candidate);
      if (nested) return nested;
    }
  }
  return null;
}

function conversationPathId(value: string): string {
  const match = value.match(/urn:li:msg_conversation:\((?:[^,]+),(.+)\)$/);
  return match?.[1] ?? value;
}

function referenceKey(value: unknown): string | null {
  const urn = entityUrn(value);
  if (urn) return urn;
  if (typeof value === "string") return value;
  return null;
}

function buildEntityMap(collection: LegacyCollection): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const value of [...(collection.included ?? []), ...(collection.elements ?? [])]) {
    const key = referenceKey(value);
    if (key && typeof value === "object") map.set(key, value);
  }
  return map;
}

function resolveReference(value: unknown, map: Map<string, unknown>): unknown {
  if (typeof value !== "string") return value;
  return map.get(value) ?? value;
}

function unwrapIdentity(value: unknown, map: Map<string, unknown>, seen = new Set<unknown>()): ParsedIdentity {
  if (seen.has(value)) return { profileUrn: null, publicIdentifier: null, profileUrl: null, name: null };
  seen.add(value);
  const resolved = resolveReference(value, map);
  if (!resolved || typeof resolved !== "object") return { profileUrn: null, publicIdentifier: null, profileUrl: null, name: null };
  const record = resolved as Record<string, unknown>;
  for (const key of ["miniProfile", "profile", "member", "participant", "from", "sender"]) {
    if (record[key]) {
      const nested = unwrapIdentity(record[key], map, seen);
      if (nested.profileUrn || nested.publicIdentifier || nested.profileUrl) {
        return {
          profileUrn: nested.profileUrn ?? entityUrn(record),
          publicIdentifier: nested.publicIdentifier ?? (typeof record.publicIdentifier === "string" ? record.publicIdentifier : null),
          profileUrl: nested.profileUrl ?? (typeof record.profileUrl === "string" ? record.profileUrl : null),
          name: nested.name ?? (typeof record.name === "string" ? record.name : null),
        };
      }
    }
  }

  const profileUrn = typeof record.profileUrn === "string"
    ? record.profileUrn
    : typeof record.entityUrn === "string" && record.entityUrn.includes("profile")
      ? record.entityUrn
      : typeof record.objectUrn === "string" && record.objectUrn.includes("profile")
        ? record.objectUrn
        : null;
  const publicIdentifier = typeof record.publicIdentifier === "string" ? record.publicIdentifier : null;
  const profileUrl = typeof record.profileUrl === "string"
    ? record.profileUrl
    : typeof record.flagshipProfileUrl === "string"
      ? record.flagshipProfileUrl
      : publicIdentifier
        ? `https://www.linkedin.com/in/${publicIdentifier}`
        : null;
  const firstName = typeof record.firstName === "string" ? record.firstName : "";
  const lastName = typeof record.lastName === "string" ? record.lastName : "";
  const name = typeof record.name === "string" ? record.name : `${firstName} ${lastName}`.trim() || null;
  return { profileUrn, publicIdentifier, profileUrl, name };
}

function identityFromEvent(value: unknown, map: Map<string, unknown>): ParsedIdentity {
  const resolved = resolveReference(value, map);
  if (resolved && typeof resolved === "object") {
    const record = resolved as Record<string, unknown>;
    for (const key of ["from", "sender", "actor", "author"]) {
      if (!record[key]) continue;
      const direct = unwrapIdentity(record[key], map);
      if (direct.profileUrn || direct.publicIdentifier || direct.profileUrl) return direct;
      const senderUrn = entityUrn(record[key]);
      if (senderUrn) {
        return { profileUrn: senderUrn, publicIdentifier: null, profileUrl: null, name: null };
      }
    }
  }
  return unwrapIdentity(resolved, map);
}

function bodyFromEvent(value: unknown, map: Map<string, unknown>): string | null {
  const resolved = resolveReference(value, map);
  if (typeof resolved === "string") return resolved.trim() || null;
  if (!resolved || typeof resolved !== "object") return null;
  const record = resolved as Record<string, unknown>;
  for (const key of ["attributedBody", "body", "text", "message", "eventContent"]) {
    if (record[key] !== undefined) {
      const body = bodyFromEvent(record[key], map);
      if (body) return body;
    }
  }
  return null;
}

function timestampFromEvent(value: unknown, map: Map<string, unknown>): string | null {
  const resolved = resolveReference(value, map);
  if (!resolved || typeof resolved !== "object") return null;
  const record = resolved as Record<string, unknown>;
  for (const key of ["createdAt", "deliveredAt", "sentAt", "timestamp"]) {
    const raw = record[key];
    const millis = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (Number.isFinite(millis) && millis > 0) return new Date(millis).toISOString();
  }
  return null;
}

function resolveElementRecords(collection: LegacyCollection): unknown[] {
  const map = buildEntityMap(collection);
  if (Array.isArray(collection.elements) && collection.elements.length > 0) {
    return collection.elements.map((value) => resolveReference(value, map));
  }
  return (collection.included ?? []).filter((value) => {
    const type = value && typeof value === "object"
      ? String((value as Record<string, unknown>)["$type"] ?? "")
      : "";
    return type.includes("Conversation") || type.includes("MessageEvent") || type.includes("Message");
  });
}

function parseConversations(
  payload: unknown,
  scopes: readonly CampaignTargetScope[],
  currentUrns: ReadonlySet<string>,
): ParsedConversation[] {
  const collection = extractLegacyCollection(payload);
  if (!collection) throw new CampaignInboxSourceError("LinkedIn conversation response shape is not recognized", "contract_mismatch");
  const map = buildEntityMap(collection);
  const values = resolveElementRecords(collection);
  const conversations: ParsedConversation[] = [];
  for (const value of values) {
    const conversation = resolveReference(value, map);
    if (!conversation || typeof conversation !== "object") continue;
    const record = conversation as Record<string, unknown>;
    const threadId = entityUrn(record) ?? (typeof record.id === "string" ? record.id : null);
    if (!threadId) continue;
    const rawParticipants = Array.isArray(record.participants)
      ? record.participants
      : Array.isArray(record.members)
        ? record.members
        : [];
    const participants = rawParticipants.map((participant) => unwrapIdentity(participant, map));
    const participant = participants.find((identity) => {
      if (identity.profileUrn && currentUrns.has(identity.profileUrn)) return false;
      const vanity = canonicalLinkedInVanity(identity.profileUrl);
      return scopes.some((scope) =>
        (!!identity.profileUrn && scope.messagingUrn === identity.profileUrn)
        || (!!vanity && canonicalLinkedInVanity(scope.linkedinUrl) === vanity)
      );
    });
    if (!participant) continue;
    conversations.push({ threadId, participant });
  }
  return conversations;
}

export function parseLegacyCampaignInboxFixture(payload: unknown, currentUrns: ReadonlySet<string>, participant: ParsedIdentity): ParsedMessage[] {
  const collection = extractLegacyCollection(payload);
  if (!collection) throw new CampaignInboxSourceError("LinkedIn message response shape is not recognized", "contract_mismatch");
  const map = buildEntityMap(collection);
  const messages: ParsedMessage[] = [];
  const values = resolveElementRecords(collection);
  for (const value of values) {
    const event = resolveReference(value, map);
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    const messageId = entityUrn(record) ?? (typeof record.id === "string" ? record.id : null);
    const sender = identityFromEvent(record, map);
    const body = bodyFromEvent(record, map);
    const sentAt = timestampFromEvent(record, map);
    if (!messageId || !sender.profileUrn || !body || !sentAt) continue;
    const isFromCurrentUser = currentUrns.has(sender.profileUrn);
    const sameParticipant = sender.profileUrn === participant.profileUrn
      || (!!sender.publicIdentifier && sender.publicIdentifier === participant.publicIdentifier)
      || (!!sender.profileUrl && canonicalLinkedInVanity(sender.profileUrl) === canonicalLinkedInVanity(participant.profileUrl));
    if (!isFromCurrentUser && !sameParticipant) continue;
    messages.push({ messageId, sender, body, sentAt, isFromCurrentUser });
  }
  return messages;
}

async function fetchJson(page: Page, url: string): Promise<JsonResponse> {
  return page.evaluate(async (requestUrl): Promise<JsonResponse> => {
    try {
      const cookies = document.cookie.split("; ").reduce((values: Record<string, string>, cookie) => {
        const index = cookie.indexOf("=");
        if (index > 0) values[cookie.slice(0, index).trim()] = cookie.slice(index + 1).trim();
        return values;
      }, {});
      const csrf = (cookies.JSESSIONID || cookies.jsessionid || "").replace(/\"/g, "");
      const headers: Record<string, string> = {
        accept: "application/vnd.linkedin.normalized+json+2.1",
        "x-restli-protocol-version": "2.0.0",
      };
      if (csrf) headers["csrf-token"] = csrf;
      const response = await fetch(requestUrl, {
        method: "GET",
        headers,
        credentials: "include",
      });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* malformed body handled below */ }
      return { status: response.status, url: response.url, body };
    } catch (err) {
      return { status: 0, url: requestUrl, body: { error: err instanceof Error ? err.message : String(err) } };
    }
  }, url);
}

function assertResponse(response: JsonResponse, kind: "api_error" | "contract_mismatch"): asserts response is JsonResponse & { body: unknown } {
  if (AUTH_WALL.test(response.url) || response.status === 401 || response.status === 403) {
    throw new CampaignInboxSourceError("LinkedIn session requires re-authentication", "auth_wall");
  }
  if (response.status === 429 || response.status < 200 || response.status >= 300) {
    throw new CampaignInboxSourceError(`LinkedIn ${kind === "api_error" ? "messaging" : "contract"} request failed (${response.status})`, "api_error");
  }
  if (response.body === null) throw new CampaignInboxSourceError("LinkedIn returned malformed JSON", "contract_mismatch");
}

function scopeForIdentity(identity: ParsedIdentity, scopes: readonly CampaignTargetScope[]): CampaignTargetScope | null {
  const byUrn = identity.profileUrn ? scopes.filter((scope) => scope.messagingUrn === identity.profileUrn) : [];
  const vanity = canonicalLinkedInVanity(identity.profileUrl);
  const byVanity = vanity ? scopes.filter((scope) => canonicalLinkedInVanity(scope.linkedinUrl) === vanity) : [];
  if (byUrn.length > 1 || byVanity.length > 1) throw new CampaignInboxSourceError("Campaign participant identity is ambiguous", "contract_mismatch");
  if (byUrn.length && byVanity.length && byUrn[0].targetId !== byVanity[0].targetId) return null;
  return byUrn[0] ?? byVanity[0] ?? null;
}

export class CampaignLinkedInMessagingSource {
  conversationsReviewed = 0;
  campaignCandidates = 0;
  private readonly maxConversationPages: number;
  private readonly maxMessagePages: number;

  constructor(
    private readonly scopes: readonly CampaignTargetScope[],
    options: CampaignMessagingSourceOptions,
  ) {
    if (options.contractVersion !== SUPPORTED_CAMPAIGN_INBOX_CONTRACT) {
      throw new CampaignInboxSourceError("LinkedIn inbox contract is not verified for this adapter", "contract_mismatch");
    }
    this.maxConversationPages = options.maxConversationPages ?? MAX_CONVERSATION_PAGES;
    this.maxMessagePages = options.maxMessagePages ?? MAX_MESSAGE_PAGES;
  }

  async observe(page: Page): Promise<CampaignInboxObservation[]> {
    this.conversationsReviewed = 0;
    this.campaignCandidates = 0;
    const currentUrns = await this.loadCurrentProfileUrns(page);
    const candidates: CandidateConversation[] = [];

    for (let pageIndex = 0; pageIndex < this.maxConversationPages; pageIndex++) {
      const start = pageIndex * PAGE_SIZE;
      const url = `${CONVERSATION_ENDPOINT}?keyVersion=LEGACY_INBOX&q=participants&start=${start}&count=${PAGE_SIZE}`;
      const response = await fetchJson(page, url);
      assertResponse(response, "api_error");
      const collection = extractLegacyCollection(response.body);
      if (!collection) {
        throw new CampaignInboxSourceError(
          "LinkedIn conversation response shape is not recognized",
          "contract_mismatch",
        );
      }
      const conversations = parseConversations(response.body, this.scopes, currentUrns);
      this.conversationsReviewed += collection.elements?.length ?? 0;
      for (const conversation of conversations) {
        const scope = scopeForIdentity(conversation.participant, this.scopes);
        if (scope) {
          candidates.push({ ...conversation, scope });
          this.campaignCandidates++;
        }
      }
      const received = collection.elements?.length ?? 0;
      if (received < PAGE_SIZE || received === 0) break;
    }

    const observations: CampaignInboxObservation[] = [];
    for (const candidate of candidates) {
      const messages = await this.loadConversationMessages(page, candidate, currentUrns);
      const selection = selectCampaignMessages(messages, candidate.scope.outboundAt);
      if (!selection) continue;

      for (const message of selection.inbound) {
        observations.push({
          externalThreadId: candidate.threadId,
          externalMessageId: message.messageId,
          direction: "inbound",
          body: message.body,
          receivedAt: message.sentAt,
          senderExternalId: message.sender.profileUrn,
          senderName: message.sender.name,
          senderMessagingUrn: message.sender.profileUrn,
          senderProfileUrl: message.sender.profileUrl,
          providerEventId: message.messageId,
          rawKind: "message",
          campaignOutboundObservedAt: selection.outbound.sentAt,
          campaignRunId: candidate.scope.runId,
          campaignWorkflowId: candidate.scope.workflowId,
        });
      }
    }

    return observations;
  }

  private async loadCurrentProfileUrns(page: Page): Promise<Set<string>> {
    const urns = new Set<string>();
    const response = await fetchJson(page, PROFILE_ENDPOINT);
    assertResponse(response, "api_error");
    if (!response.body || typeof response.body !== "object") {
      throw new CampaignInboxSourceError("LinkedIn current-user response shape is not recognized", "contract_mismatch");
    }
    const visit = (value: unknown, depth: number): void => {
      if (depth > 5 || !value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      for (const key of ["entityUrn", "objectUrn", "profileUrn"]) {
        if (typeof record[key] === "string" && record[key].includes("profile")) urns.add(record[key]);
      }
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === "object") visit(nested, depth + 1);
      }
    };
    visit(response.body, 0);
    if (urns.size === 0) {
      throw new CampaignInboxSourceError("LinkedIn current-user profile URN is missing", "contract_mismatch");
    }
    return urns;
  }

  private async loadConversationMessages(
    page: Page,
    candidate: CandidateConversation,
    currentUrns: ReadonlySet<string>,
  ): Promise<ParsedMessage[]> {
    const all: ParsedMessage[] = [];
    for (let pageIndex = 0; pageIndex < this.maxMessagePages; pageIndex++) {
      const url = `${CONVERSATION_ENDPOINT}/${encodeURIComponent(conversationPathId(candidate.threadId))}/events?start=${pageIndex * 100}&count=100`;
      const response = await fetchJson(page, url);
      assertResponse(response, "api_error");
      const collection = extractLegacyCollection(response.body);
      if (!collection) {
        throw new CampaignInboxSourceError(
          "LinkedIn message response shape is not recognized",
          "contract_mismatch",
        );
      }
      all.push(...parseLegacyCampaignInboxFixture(response.body, currentUrns, candidate.participant));
      const received = collection.elements?.length ?? 0;
      if (received < 100 || received === 0) break;
    }
    if (all.length === 0) return [];
    const byId = new Map(all.map((message) => [message.messageId, message]));
    return [...byId.values()].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  }
}
