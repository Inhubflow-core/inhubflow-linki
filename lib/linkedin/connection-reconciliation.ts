export interface VoyagerConnectionEntity {
  $type?: string;
  entityUrn?: string;
  createdAt?: number;
  connectedMember?: string;
  publicIdentifier?: string;
}

export interface VoyagerConnectionsPayload {
  data?: { "*elements"?: unknown[] };
  included?: VoyagerConnectionEntity[];
}

export interface AcceptedConnectionIdentity {
  vanity: string | null;
  memberUrn: string | null;
  createdAt: number;
}

export interface ParsedConnectionsPage {
  connections: AcceptedConnectionIdentity[];
  referencedElements: number;
  unresolvedIdentities: number;
}

export interface PendingConnectionTarget {
  id: string;
  linkedinUrl: string | null;
  messagingUrn: string | null;
  linkedinMemberUrn: string | null;
  connectionRequestedAt: string;
}

export interface ConnectionMatch {
  targetId: string | null;
  conflictTargetIds: string[];
  matchedBy: "vanity" | "urn" | null;
}

export interface ScanFloorInput {
  boundaryMs: number | null;
  pendingRequestedAt: readonly string[];
  nowMs?: number;
  overlapMs: number;
  maxWaitMs: number;
  requestMarginMs: number;
}

export function canonicalLinkedInVanity(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/\/in\/([^/?#]+)/i);
  const raw = match?.[1] ?? (/^[^/?#]+$/.test(trimmed) ? trimmed : null);
  if (!raw) return null;

  try {
    return decodeURIComponent(raw).trim().toLowerCase() || null;
  } catch {
    return raw.trim().toLowerCase() || null;
  }
}

export function parseVoyagerConnections(payload: VoyagerConnectionsPayload): ParsedConnectionsPage {
  const included = Array.isArray(payload.included) ? payload.included : [];
  const vanityByUrn = new Map<string, string>();

  for (const entity of included) {
    if (!(entity.$type ?? "").includes("identity.profile.Profile")) continue;
    if (!entity.entityUrn || !entity.publicIdentifier) continue;
    const vanity = canonicalLinkedInVanity(entity.publicIdentifier);
    if (vanity) vanityByUrn.set(entity.entityUrn, vanity);
  }

  let unresolvedIdentities = 0;
  const connections: AcceptedConnectionIdentity[] = [];
  for (const entity of included) {
    if (!(entity.$type ?? "").includes("relationships.Connection")) continue;
    if (typeof entity.createdAt !== "number" || !Number.isFinite(entity.createdAt)) continue;

    const memberUrn = entity.connectedMember?.trim() || null;
    const vanity = memberUrn ? vanityByUrn.get(memberUrn) ?? null : null;
    if (!vanity && !memberUrn) unresolvedIdentities++;
    connections.push({ vanity, memberUrn, createdAt: entity.createdAt });
  }

  connections.sort((a, b) => b.createdAt - a.createdAt);
  return {
    connections,
    referencedElements: Array.isArray(payload.data?.["*elements"])
      ? payload.data!["*elements"]!.length
      : 0,
    unresolvedIdentities,
  };
}

export function calculateConnectionScanFloor(input: ScanFloorInput): number | null {
  if (input.boundaryMs === null) return null;

  const normalFloor = input.boundaryMs - input.overlapMs;
  const oldestAllowed = (input.nowMs ?? Date.now()) - input.maxWaitMs - input.requestMarginMs;
  let pendingFloor: number | null = null;

  for (const value of input.pendingRequestedAt) {
    const requestedAt = Date.parse(value);
    if (!Number.isFinite(requestedAt)) continue;
    const candidateFloor = Math.max(requestedAt - input.requestMarginMs, oldestAllowed);
    if (pendingFloor === null || candidateFloor < pendingFloor) pendingFloor = candidateFloor;
  }

  return pendingFloor === null ? normalFloor : Math.min(normalFloor, pendingFloor);
}

function exactUrns(target: PendingConnectionTarget): string[] {
  return [target.messagingUrn, target.linkedinMemberUrn]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
}

export function matchAcceptedConnection(
  connection: AcceptedConnectionIdentity,
  targets: readonly PendingConnectionTarget[],
): ConnectionMatch {
  const vanityMatches = connection.vanity
    ? targets.filter((target) => canonicalLinkedInVanity(target.linkedinUrl) === connection.vanity)
    : [];

  if (vanityMatches.length === 1) {
    return { targetId: vanityMatches[0].id, conflictTargetIds: [], matchedBy: "vanity" };
  }
  if (vanityMatches.length > 1) {
    return {
      targetId: null,
      conflictTargetIds: vanityMatches.map((target) => target.id),
      matchedBy: null,
    };
  }

  const urnMatches = connection.memberUrn
    ? targets.filter((target) => exactUrns(target).includes(connection.memberUrn!))
    : [];
  if (urnMatches.length === 1) {
    return { targetId: urnMatches[0].id, conflictTargetIds: [], matchedBy: "urn" };
  }
  if (urnMatches.length > 1) {
    return {
      targetId: null,
      conflictTargetIds: urnMatches.map((target) => target.id),
      matchedBy: null,
    };
  }

  return { targetId: null, conflictTargetIds: [], matchedBy: null };
}
