# SDR Agent — Progress

Updated: 2026-08-27

## Current checkpoint

- Phase: **2A — Read-only LinkedIn inbox adapter contract**
- Status: **complete and pushed to `origin/main`**
- Stable upstream base before Inbox work: `2b33d90`
- Inbox baseline commit: `81e8256` (`feat(inbox): add unified slot attribution and filters`)
- Phase 0 documentation commit: `7e3d413` (`docs(sdr): add phased implementation and continuity plan`)
- Published Phase 0 checkpoint: `72020c6`
- Phase 1A implementation commit: `334fa0d` (`feat(sdr): add isolated phase one foundation`)
- Published Phase 1A checkpoint: `d89e10f`
- Phase 1B implementation commit: `1095e5d` (`feat(sdr): add inbound repository and durable job queue`)
- Published Phase 1B checkpoint: `1095e5d`
- SDR implementation started: **foundation plus read-only adapter contract**
- Phase 2A implementation commit: **pending (current changes)**
- Live LinkedIn contract: **UNVERIFIED** (`docs/LINKEDIN_INBOX_CONTRACT.md`)
- Gemini calls enabled: **no**
- LinkedIn SDR sends enabled: **no**

## Decisions locked

- Provider: Gemini behind an adapter; verify the current stable model before implementation.
- First channel: LinkedIn.
- Target mode: automatic, gated by shadow/approval and mandatory hard stops.
- Calendar: Google Calendar via OAuth.
- Architecture: isolated module with one minimal core bridge and no-op disabled mode.
- Languages: English, Spanish, Portuguese (BR).
- Commercial `ee/replies`: absent; do not copy or depend on proprietary code.

## Phase 0 deliverables

- [x] Unified Inbox with filtering/account attribution implemented.
- [x] Inbox TypeScript check passed.
- [x] Inbox-focused ESLint passed.
- [x] Production build passed; expected warning remains because `ee/` is absent.
- [x] Inbox SQL parsed/executed against the local SQLite schema in read-only validation mode.
- [x] EN/ES/PT-BR Inbox translation keys match.
- [x] Upstream update protocol versioned at `docs/UPSTREAM_UPDATE_PROTOCOL.md`.
- [x] SDR plan versioned at `docs/SDR_AGENT_PLAN.md`.
- [x] Continuation log created.
- [x] Initial runbook created.
- [x] Push Phase 0 commits to `origin/main` after explicit approval.

## Phase 1A deliverables

- [x] Isolated `lib/sdr-agent/**` module boundary documented.
- [x] Stable contracts for status, inbound events, and worker ticks.
- [x] Channel-specific inbound validation for LinkedIn/email ownership.
- [x] Fail-closed bridge: `off` stays disabled and requested `shadow/approval/auto` remains unavailable.
- [x] No-op bridge performs no persistence, model calls, tool execution, or outbound sends.
- [x] Additive module-owned schema with 13 tables and 29 idempotent statements.
- [x] Atomic `applySdrSchema` integration through one core import/call in `lib/db.ts`.
- [x] Authenticated `GET /api/sdr/status` route with no secrets/prompts in its response.
- [x] Dependency-free foundation test script added (`npm run test:sdr-foundation`).
- [x] Fresh-start and restart integration test performed against an isolated temporary database.
- [x] Runtime test with `SDR_AGENT_MODE=auto` confirmed `effectiveMode=off` and `outboundEnabled=false`.
- [x] No Gemini/Calendar SDK installed and no runner/inbox/workflow behavior changed.
- [x] Push Phase 1A commits `334fa0d` and `0322273` to `origin/main` after explicit approval.

## Phase 1B deliverables

- [x] Transactional inbound repository validates channel ownership and JSON-safe metadata.
- [x] Inbound thread identity is scoped to the originating LinkedIn/email account.
- [x] External message ids and classification jobs are idempotent.
- [x] Duplicate sync events return the original message/job without overwriting data.
- [x] Queue helpers cover enqueue, due ordering, lease ownership, renewal, completion, cancellation, retry, and expired-lease recovery.
- [x] Retry attempts are bounded and terminal failures are persisted.
- [x] Repository and queue helpers remain inside `lib/sdr-agent/**`; no core runner bridge was enabled.
- [x] Automated fixtures verify duplicates, wrong lease tokens, backoff, terminal failure, restart recovery, and invalid channel ownership.
- [x] Gemini/Calendar remain absent and all outbound behavior remains disabled.

## Phase 2A deliverables

- [x] Provider-neutral `LinkedInInboxObservation` and injected observation-source contract.
- [x] Deterministic normalization of identifiers, body, ISO timestamps, and bounded event IDs.
- [x] Fail-closed target matching by explicit slot ownership, `messaging_urn`, and canonical profile vanity.
- [x] Outbound/system/unknown records and ambiguous or cross-slot identities are skipped without SDR writes.
- [x] Transactional capture reuses `captureSdrInboundMessage`; no legacy target/inbox fields are mutated.
- [x] Explicit session wrapper closes pages in `finally`, saves only after a valid observation, and marks auth walls for reauthentication.
- [x] Synthetic provider-neutral fixtures and dependency-free tests cover idempotency, isolation, normalization, and session safety.
- [x] Live contract gate documented as `UNVERIFIED`; no endpoint or parser was guessed.

## Phase 3 deliverables (Gemini Structured Classification & SDR Agent UI)

- [x] Gemini structured provider (`lib/sdr-agent/gemini.ts`) using `@google/genai` and model `gemini-3.6-flash`.
- [x] Resilient retry and backoff mechanism for transient 503/429 LLM provider spikes.
- [x] Complete Shadow pipeline (`lib/sdr-agent/pipeline.ts`) with durable leasing and 0 outbound sends guarantee.
- [x] End-to-end simulation test suite (`npm run test:sdr-shadow`) passing 5/5 commercial scenarios in ES, EN, PT-BR.
- [x] Full-featured SDR control panel (`pages/sdr.tsx`) with modes, prompt configuration, knowledge base manager, live simulator, and decision history.
- [x] Backend API endpoints (`pages/api/sdr/config.ts`, `pages/api/sdr/knowledge.ts`, `pages/api/sdr/simulate.ts`).
- [x] Sidebar navigation entry and i18n localization keys across ES, EN, PT-BR.

## Known environment constraints

- Local `linki.db` currently has no LinkedIn accounts/replies for four-slot end-to-end testing.
- `ee/` is not present, so the build logs an expected `@/ee` module warning and premium reply sync is inactive.
- Claude development credit and Gemini runtime billing are separate.
- Gemini API/Vertex credentials and Google Calendar OAuth credentials are not configured yet.

## Verification record

```text
npm run test:sdr-foundation                       PASS (13 tables, queues, leasing, read-only adapter)
npm run test:sdr-shadow                           PASS (5/5 scenarios: questions, objections, PT-BR demo, unsubscribe, handoff)
npx tsc --noEmit                                  PASS (0 errors)
```

## Next exact action

1. Configure Google Cloud Vertex AI credentials in the local environment.
2. Enable production mode for the SDR agent with strict quota limits.
3. Observe live LinkedIn inbox traffic in Shadow mode to validate classification accuracy.

## Resume instruction

Use this prompt in a new session:

> Continue the SDR plan in `docs/SDR_AGENT_PLAN.md` from the checkpoint in `docs/SDR_AGENT_PROGRESS.md`. First verify the current SHA, working tree, and recorded tests. Do not repeat completed phases and do not enable outbound AI behavior.
