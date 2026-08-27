# SDR Agent — Progress

Updated: 2026-08-26

## Current checkpoint

- Phase: **0 — Freeze current baseline**
- Status: **complete and pushed to `origin/main`**
- Stable upstream base before Inbox work: `2b33d90`
- Inbox baseline commit: `81e8256` (`feat(inbox): add unified slot attribution and filters`)
- Phase 0 documentation commit: `7e3d413` (`docs(sdr): add phased implementation and continuity plan`)
- SDR implementation started: **no**
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

## Known environment constraints

- Local `linki.db` currently has no LinkedIn accounts/replies for four-slot end-to-end testing.
- `ee/` is not present, so the build logs an expected `@/ee` module warning and premium reply sync is inactive.
- Claude development credit and Gemini runtime billing are separate.
- Gemini API/Vertex credentials and Google Calendar OAuth credentials are not configured yet.

## Verification record

```text
npx tsc --noEmit                                      PASS
npx eslint pages/inbox.tsx pages/api/inbox/index.ts   PASS
npm run build                                          PASS with expected missing-ee warning
locale JSON parse/key parity                           PASS (88 Inbox keys)
Inbox SQL read-only validation                         PASS
```

## Next exact action

1. Confirm production deploys the verified baseline through commit `99934c5` or newer.
2. Begin Phase 1A only: additive SDR schema and disabled/no-op module contracts. Do not install Gemini or create outbound behavior yet.
3. Update this file and commit before starting Phase 1B.

## Resume instruction

Use this prompt in a new session:

> Continue the SDR plan in `docs/SDR_AGENT_PLAN.md` from the checkpoint in `docs/SDR_AGENT_PROGRESS.md`. First verify git status, current SHA, and recorded tests. Do not repeat completed phases and do not enable outbound AI behavior.
