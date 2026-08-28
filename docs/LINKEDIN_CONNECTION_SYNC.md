# LinkedIn accepted-connection reconciliation

## Source of truth

Linki treats presence in LinkedIn's authenticated connections API as the authoritative proof that a request was accepted. It never treats disappearance from the sent-invitations page as acceptance because an invitation can also expire, be withdrawn, or be rejected.

The implementation lives in:

- `lib/linkedin/sync-accepted.ts` — session lifecycle, account-scoped pagination and persistence.
- `lib/linkedin/connection-reconciliation.ts` — deterministic identity normalization, response parsing, cursor horizon and matching.
- `lib/linkedin/visit.ts` — read-only live-profile fallback immediately before a DM.

## Safety invariants

- Match by canonical `/in/<vanity>` or an exact observed profile URN; never by display name.
- A target with run history on different LinkedIn slots is ambiguous under the current global target schema and is not auto-marked.
- Incremental syncs are add-only.
- A partial/API/auth failure does not advance `connections_synced_through_ms` or `accepted_sync_at`.
- The scan horizon always includes still-actionable pending requests, even when they are older than the normal cursor overlap.
- Negative correction is allowed only after a complete pass with LinkedIn's total-count checksum and only for targets scoped unambiguously to that account.
- The message runner performs an authoritative preflight and then a live profile check; `sendMessage` remains the final refusal boundary.
- Runner ticks are serialized so repeated `Run now` requests cannot execute the same track concurrently in one process.

## Logs

A successful recovery looks like:

```text
[sync-accepted] Accepted via vanity: <target-id> (<vanity>)
[sync-accepted] Complete: 1 accepted, ...
<name> confirmed as 1st-degree via connections API ... — proceeding with message
Sending message to <name>
Message sent to <name>
```

An incomplete pass logs its reason (`auth_wall`, `api_error`, `page_limit`, or `invalid_response`) and remains due for retry rather than waiting another eight hours.

## Verification

Run without accessing LinkedIn:

```bash
npm run test:linkedin-connection-sync
npx tsc --noEmit
```

For production, deploy first and use one consented test contact. Trigger `Run now` once, verify one accepted-match log and one sent-message log, then confirm the DM on the receiving account. Never repair `degree` manually unless the source-of-truth check has independently confirmed the identity and slot.
