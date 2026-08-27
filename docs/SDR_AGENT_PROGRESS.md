# SDR Agent — Progress

Updated: 2026-08-27

## Current checkpoint

- Phase: **1A — Additive schema and disabled module contracts**
- Status: **complete locally; pending commit/push**
- Stable upstream base before Inbox work: `2b33d90`
- Inbox baseline commit: `81e8256` (`feat(inbox): add unified slot attribution and filters`)
- Phase 0 documentation commit: `7e3d413` (`docs(sdr): add phased implementation and continuity plan`)
- Published Phase 0 checkpoint: `72020c6`
- Phase 1A implementation commit: **pending (current changes)**
- SDR implementation started: **foundation only**
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

## Known environment constraints

- Local `linki.db` currently has no LinkedIn accounts/replies for four-slot end-to-end testing.
- `ee/` is not present, so the build logs an expected `@/ee` module warning and premium reply sync is inactive.
- Claude development credit and Gemini runtime billing are separate.
- Gemini API/Vertex credentials and Google Calendar OAuth credentials are not configured yet.

## Verification record

```text
npm run test:sdr-foundation                       PASS
npx tsc --noEmit                                  PASS
npx eslint lib/sdr-agent pages/api/sdr/status.ts  PASS
npm run build                                     PASS with expected missing-ee warning
fresh/restart isolated DB schema                 PASS (13 tables, no FK violations)
/api/sdr/status with auto mode                   PASS (effective off, outbound false)
```

## Next exact action

1. Commit the verified Phase 1A foundation as one atomic commit.
2. Push it to `origin/main` only after explicit user approval.
3. Begin Phase 1B only after that commit is deployed/known: repository helpers and lease/retry primitives, still with no Gemini calls or outbound actions.
4. Update this file and commit before starting Phase 1B.

## Resume instruction

Use this prompt in a new session:

> Continue the SDR plan in `docs/SDR_AGENT_PLAN.md` from the checkpoint in `docs/SDR_AGENT_PROGRESS.md`. First verify git status, current SHA, and recorded tests. Do not repeat completed phases and do not enable outbound AI behavior.
