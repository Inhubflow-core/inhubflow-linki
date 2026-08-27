# LinkedIn Inbox Contract

**Status: `UNVERIFIED`**

This document is a gate for the SDR LinkedIn inbox adapter. No LinkedIn messaging endpoint, GraphQL operation, decoration ID, request payload, response mapping, or pagination assumption may be added to production code until the contract is observed in an authorized, controlled account and recorded here with a sanitized fixture.

## Current state

- Phase 2A adapter: provider-neutral normalization, account ownership checks, and explicit read-only capture only.
- Base SHA: `1095e5d`.
- No production network source is implemented.
- No runner/scheduler integration exists.
- Gemini, AI processing, and LinkedIn outbound actions remain disabled.
- `ee/` is absent from this checkout; the legacy premium reply sync is unavailable.
- Blocker: a controlled LinkedIn account and a current, consented observation of the inbox wire contract are required for Phase 2B.

## Observation record

Complete this section only after an authorized observation:

- Observation date:
- Linki application SHA:
- Controlled account designation (no email or personal identifier):
- Observer / authorization reference:
- LinkedIn page action that caused inbox data to load:
- Whether the action was read-only (no send, mark-read, archive, reaction, or delete):

## Request contract (redacted)

- URL and path:
- Method:
- Content type:
- Query parameters (values containing identifiers or tokens removed):
- Request body shape (message text, cookies, tokens, and personal data removed):
- Required non-secret headers:
- Authentication/session behavior (describe, do not copy credential values):
- Response status codes observed:

## Response mapping (redacted)

Record exact paths from the sanitized response fixture; do not infer or paraphrase them.

- Thread identifier path and type:
- Message identifier path and type:
- Participant identity path and type:
- Current-user / sender discriminator path:
- Direction discriminator and values:
- Message body/content path and type:
- Timestamp path, unit, and timezone semantics:
- Participant profile URL/vanity path:
- Participant messaging URN path and identity type:
- Conversation ordering semantics:
- Empty response shape:
- Malformed-record behavior:

## Pagination and failure behavior

- Page size:
- Cursor or continuation path:
- End-of-page marker:
- Duplicate behavior across pages:
- Maximum safe page count:
- Login/session-expired response:
- Auth wall/checkpoint response:
- Provider error and retry behavior:
- Rate-limit behavior:

## Fixture provenance and redaction

A future exact-response fixture must be stored under `fixtures/linkedin-inbox/` only after this contract is verified. It must be sanitized before being committed:

- Replace names, profile URLs, URNs, thread IDs, message IDs, timestamps, and message bodies with synthetic values while preserving types and relationships.
- Remove cookies, CSRF values, authorization headers, browser storage, access tokens, request signatures, account emails, and full unneeded envelopes.
- Retain only fields needed to prove the mappings above.
- Mark the fixture as an exact observed response and link each parser mapping to a response path.

Until then, the repository fixtures are explicitly `synthetic-provider-neutral` normalized observations. They are not claims about LinkedIn's current API response format.

## Approval gate for Phase 2B

Change `UNVERIFIED` to `VERIFIED` only when:

1. The observation was made with authorization and a controlled account.
2. The complete request/response and pagination mapping is documented above.
3. A sanitized fixture reproduces the observed mapping without secrets or live personal data.
4. Read-only behavior, session-wall handling, identity attribution, and deduplication pass automated tests.
5. The source is reviewed to confirm it cannot send or mutate LinkedIn state.

A verified contract still does not authorize runner scheduling, AI classification, or outbound replies; those require their own checkpoints and gates in `docs/SDR_AGENT_PLAN.md`.
