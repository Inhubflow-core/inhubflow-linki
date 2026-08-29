# LinkedIn Inbox Contract

**Status: `CANDIDATE_CANARY`**

This document gates the read-only LinkedIn campaign-inbox adapter. The source is disabled by default and must fail closed when LinkedIn no longer returns the exact recognized shape.

## Current implementation

- The existing Linki Inbox UI/API remains the only Inbox.
- `lib/linkedin/campaign-inbox-source.ts` contains a **read-only GET-only candidate source** for the legacy normalized Voyager messaging contract.
- `lib/linkedin/campaign-inbox.ts` admits only contacts for which the exact LinkedIn account/run has a persisted `Message sent` or `InMail sent` campaign log.
- Personal/unmatched/ambiguous/cross-slot conversations are not persisted and message bodies are never logged.
- Captured campaign replies are idempotent in `linkedin_inbox_messages`, update `targets.last_replied_at`/slot attribution, stop remaining tracks, and appear in the existing Inbox.
- The automatic scheduler requires all three environment gates:

```text
LINKEDIN_CAMPAIGN_INBOX_SYNC_ENABLED=true
LINKEDIN_INBOX_CONTRACT_VERIFIED=true
LINKEDIN_INBOX_CONTRACT_VERSION=legacy-voyager-v1
```

Keep the scheduler flag `false` until the controlled canary below succeeds. The manual authenticated endpoint can run while the scheduler remains disabled, but still requires the verified/version gates:

```text
POST /api/accounts/<account-id>/sync-linkedin-inbox
```

## Candidate request contract

### Current-user identity

```text
GET https://www.linkedin.com/voyager/api/me
Accept: application/vnd.linkedin.normalized+json+2.1
x-restli-protocol-version: 2.0.0
csrf-token: <JSESSIONID value, never logged>
credentials: include
```

### Conversation list

```text
GET https://www.linkedin.com/voyager/api/messaging/conversations
  ?keyVersion=LEGACY_INBOX
  &q=participants
  &start=<offset>
  &count=20
```

### Thread events

```text
GET https://www.linkedin.com/voyager/api/messaging/conversations/<encoded-thread-id>/events
  ?start=<offset>
  &count=100
```

All requests are made through the already-authenticated Playwright page context. The adapter has no send, mark-read, archive, reaction, delete, POST, PUT, PATCH, or DELETE path.

## Candidate response mapping

The adapter accepts a normalized collection only when it contains `elements[]` and/or `included[]`.

- Conversation ID: `entityUrn` (or explicit `id` fallback).
- Participants: `participants[]` or `members[]`, normalized through referenced entities in `included[]`.
- Participant identity: exact profile `entityUrn/profileUrn/objectUrn`, plus `publicIdentifier/flagshipProfileUrl` for vanity agreement.
- Message ID: event `entityUrn` (or explicit `id` fallback).
- Sender: `from`, `sender`, `actor`, or `author`, resolved through normalized entity references.
- Body: `attributedBody.text`, `body.text`, `body`, `text`, `message`, or `eventContent` as recognized by the strict recursive parser.
- Timestamp: epoch-ms `createdAt`, `deliveredAt`, `sentAt`, or `timestamp`.
- Direction: current-user profile URN from `/voyager/api/me` versus the exact campaign participant URN/vanity.
- Pagination: bounded `start/count`; a short page terminates. Page caps are 50 conversations and 10 event pages per candidate thread.

A contract mismatch returns `contract_mismatch`, persists no observations from that pass, and does not advance `linkedin_inbox_synced_at`.

## Campaign-only admission gate

A conversation is eligible only when:

1. Its participant resolves exactly and unambiguously to a target for the same `account_id`.
2. That target/run has a `logs` entry beginning with `Message sent` or `InMail sent`.
3. The fetched thread contains an outbound event from the current LinkedIn user at or after that campaign log (10-minute timestamp tolerance).
4. The captured event is inbound from the matched participant and occurred after that outbound event.

A list membership, visit, connection, accepted connection, target row, or display-name match is never sufficient. Names are not used for identity.

## Controlled canary procedure

Use only the authorized test pair already used for `RobertoOrSe Agencia`.

1. Keep `LINKEDIN_CAMPAIGN_INBOX_SYNC_ENABLED=false`.
2. Set only after authorization:

```text
LINKEDIN_INBOX_CONTRACT_VERIFIED=true
LINKEDIN_INBOX_CONTRACT_VERSION=legacy-voyager-v1
```

3. Redeploy and call the manual endpoint once for the `Roberto OrSe` slot.
4. Verify the response reports one or more campaign candidates and captures the known reply exactly once.
5. Verify the existing Inbox shows the body under the correct slot and campaign.
6. Verify a known personal conversation is absent from `linkedin_inbox_messages` and the Inbox.
7. Call the endpoint again and verify `captured=0` with duplicates only.
8. Inspect logs for counts only; no message body, cookie, CSRF token, full URN, or raw provider payload may appear.
9. If the endpoint reports `contract_mismatch`, `auth_wall`, `api_error`, an unexpected personal capture, or the known reply is absent, disable the verified flag and keep the scheduler off.
10. Only after these checks may `LINKEDIN_CAMPAIGN_INBOX_SYNC_ENABLED=true` be enabled for a one-slot canary.

## Sanitized fixture requirement

Before promoting from candidate canary to fully verified production operation, save a synthetic fixture under `fixtures/linkedin-inbox/` that preserves only types and reference relationships. Replace all names, URLs, URNs, thread/message IDs, timestamps, and bodies; remove cookies, CSRF values, request signatures, browser storage and account emails.

## Failure behavior

- `401/403`, login/authwall/checkpoint: mark account for reauthentication; no sync marker advance.
- `429` or non-2xx: `api_error`; no sync marker advance.
- Unknown/malformed shape: `contract_mismatch`; no capture/marker advance.
- Ambiguous, wrong-slot, personal or unmatched participant: skip before body persistence.
- Duplicate external message: no-op.
- Scheduler kill switch off: no network source is invoked by the runner.

## External references

The candidate contract was cross-checked against public technical references, but those references do not replace the controlled canary:

- https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md
- https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/ENDPOINTS.md
- https://github.com/Desearch-ai/linkedin-dms/issues/4
