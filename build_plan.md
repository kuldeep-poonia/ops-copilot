# Ops Co-pilot — Phase-Wise Build Plan

Testing philosophy for this whole project: the goal of every test listed here is to **break the product**, not to confirm it does what you already assume it does. No plain unit tests that just check a function returns what it was written to return — every test tries a malformed input, a race condition, a missing dependency, an adversarial agent call, or a real-world failure mode, and confirms the system degrades safely instead of crashing, corrupting state, or silently doing the wrong thing.

---

## Phase 0 — Project Setup

**Steps**
- Initialize the repository: `.gitignore` (excluding secrets/`.env`/build artifacts from the first commit), LICENSE, base README stub.
- Set up Go module structure (`backend/`) and frontend project (`frontend/`).
- Set up config loading (env vars for DB connection, metrics adapter choice, service registry) — no hard-coded config values anywhere in code.
- Set up linting/formatting for both (Go: `gofmt` + `staticcheck`; frontend: `eslint` + `prettier`) and wire them into a pre-commit check.

**Hardcore tests**
- Start the app with no `.env` / missing required config values — it must fail fast with a clear error, not start up in a broken half-configured state.
- Start the app with an invalid DB connection string — must fail fast, not retry silently forever or crash with an unhandled panic.

**Security**
- Confirm no secrets are present anywhere in the initial commit history (scan before pushing).
- Confirm `.gitignore` actually excludes `.env` and any credential files before the first commit that touches them.

---

## Phase 1 — Core Backend: Service Registry, Metrics Adapter, Health Aggregation

**Steps**
- Define the `MetricsSource` interface (`GetServiceHealth`, `ListAlerts`).
- Implement one real adapter (e.g., a lightweight self-reporting collector, or a real Prometheus client if Prometheus is already running against the monitored services).
- Build the service registry (which services exist, how to reach them) backed by the database.
- Build the health aggregation endpoint (`GET /services/:id/health`) that normalizes adapter output into the standard shape.

**Hardcore tests**
- Point the adapter at a service that is completely unreachable (network down) — endpoint must return a clear "unreachable" status, not hang or crash.
- Feed the adapter deliberately malformed/unexpected metrics data (wrong types, missing fields, absurd values like negative CPU) — aggregation must not panic, must sanitize/reject gracefully.
- Hit the health endpoint with 500 concurrent requests for the same service — no race conditions, no duplicate DB writes, consistent response.
- Kill the database connection mid-request — endpoint must return a clean 5xx, not crash the process.

**Security**
- Validate every path/query parameter (service IDs) against the registry before using it in any query — no path traversal, no SQL injection via unvalidated service IDs.
- Ensure the metrics adapter's own credentials (if any) are pulled from environment/secret store, never logged, never returned in any API response.
- Rate-limit the health endpoint per session to prevent it from being used to hammer the underlying metrics source.

---

## Phase 2 — Alert Engine and Audit Log

**Steps**
- Build threshold-based alert evaluation (error rate, CPU, memory thresholds per service, configurable).
- Build alert lifecycle: created → acknowledged → resolved, with severity levels.
- Build the audit log writer: every action attempt gets an immutable record (actor, action, params, timestamp, result).
- Build `GET /alerts` and `GET /audit-log` endpoints.

**Hardcore tests**
- Trigger the same alert condition rapidly and repeatedly (flapping service) — must not create hundreds of duplicate alert rows; must dedupe/update existing alert instead.
- Attempt to acknowledge an alert that doesn't exist / already resolved / belongs to a different service than claimed — must reject cleanly with a specific error, not silently succeed.
- Write 10,000 audit log entries in a burst and confirm read performance on `GET /audit-log` doesn't degrade unacceptably (add pagination if needed — decide now, not later).
- Kill the process mid-write to the audit log — on restart, confirm no corrupted/partial record was left in a way that breaks subsequent reads.

**Security**
- Audit log is append-only at the application layer — no endpoint exists that can edit or delete a past audit record.
- Alert acknowledgment and note-adding endpoints validate the authenticated user has access to that specific service before allowing the action.
- Confirm audit log entries never contain secrets even if a downstream error message would otherwise include one (scrub before persisting).

---

## Phase 3 — Action Executor and Confirmation Guardrail (the critical safety layer)

**Steps**
- Build the action executor: the only code path allowed to call a real service's restart/scale control API.
- Build the confirmation token system: server generates a token only after a genuine `requestUserInteraction` completes in the browser; token is single-use, short-lived, and bound to the exact action + exact parameters.
- Wire `restart_service` / `scale_service` so the first call always returns "confirmation required," and the actual execution only happens on a second call carrying a valid token.
- Wire `acknowledge_alert` / `add_incident_note` as low-risk tools that execute immediately (no token required) but are still fully audited.

**Hardcore tests — this phase gets the most adversarial testing in the whole project**
- Call the high-risk action endpoint directly (bypassing the tool/dialog flow entirely) with no token — must be rejected.
- Call it with an expired token — must be rejected.
- Call it with a valid token issued for a *different* service or *different* action — must be rejected.
- Call it twice with the same valid token (replay) — second call must be rejected, first action must not execute twice.
- Fire two different valid confirmation flows for the same service at nearly the same time (two people/agents approving conflicting actions) — system must serialize them, not race, and must not leave the service in an inconsistent state.
- Simulate the real service's control API timing out mid-restart — executor must not silently mark it as "success," and must surface the ambiguous state clearly (audit log should reflect "unknown outcome," not a guessed one).
- Simulate the real service's control API returning an error — must propagate a clear failure back through the tool response to the agent, and log it.
- Attempt to forge a confirmation token client-side (predictable/short token) — token generation must use a cryptographically secure random value long enough to make guessing infeasible.

**Security**
- Confirmation tokens are generated with a cryptographically secure random source, sufficient length/entropy, stored hashed (not plaintext) in the database, same treatment as a password reset token would get.
- The action executor uses the least-privileged credential available for each real service's control API — confirm this explicitly per service, don't reuse one broad credential across all of them.
- Every high-risk action attempt (approved or rejected, successful or failed) is logged with full context — this is the most important part of the audit trail in the whole system.
- Add per-user rate limiting specifically on high-risk action attempts, independent of general API rate limits, since these are the highest-consequence calls in the product.

---

## Phase 4 — WebMCP Tool Registration and Frontend Dashboard

**Steps**
- Build the React dashboard: live status cards per service, alert list, audit log view.
- Register all WebMCP tools (`get_service_health`, `list_active_alerts`, `get_audit_log`, `acknowledge_alert`, `add_incident_note`, `restart_service`, `scale_service`) with precise `inputSchema` and intent-revealing `description` fields.
- Build the confirmation dialog component wired to `requestUserInteraction`, showing the real parameters of the proposed action, not just the agent's summary of it.
- Wire tool `execute` functions to call the real backend endpoints, handling and surfacing backend errors distinctly (network error vs. rejected vs. confirmation required).

**Hardcore tests**
- Open the dashboard, then kill the backend mid-session — UI must show a clear degraded state, not a blank crash or stale "everything's fine."
- Trigger a high-risk tool call from the agent, then close the confirmation dialog without responding, then reopen the dashboard — the pending action must not silently execute; the token must expire correctly.
- Call an unregistered/misspelled tool name from an agent context — must fail gracefully on the agent side (proves the schema/description is precise enough that this shouldn't happen in normal use, but confirm the failure mode is clean).
- Unmount/remount the dashboard repeatedly (navigation, refresh) — confirm no duplicate tool registrations pile up (`unregisterTool` must actually run on cleanup).
- Feed the confirmation dialog an action with an unexpectedly long/weird service name or note text (very long strings, special characters, script-like content) — must render safely, no injection into the DOM.

**Security**
- All rendered data (service names, alert messages, incident notes, agent-provided reasons) is properly escaped/sanitized before rendering — no stored or reflected XSS from any field an agent or user can influence.
- WebMCP tools are not exposed to cross-origin frames beyond what's explicitly needed; permissions policy reviewed and set deliberately, not left at a permissive default.
- Confirmation dialog content is generated from the backend's validated record of the pending action, not directly from unvalidated tool-call parameters passed through the agent.

---

## Phase 5 — Deployment and Hardening

**Steps**
- Deploy backend and frontend (HTTPS required — WebMCP only works in a secure context anyway).
- Set up environment-specific config (staging vs. production service registry, real credentials via secret manager).
- Set up basic monitoring of the product itself (yes, monitor the monitor) — uptime and error-rate alerting on the Ops Co-pilot backend.
- Write the README (setup, run locally, deploy, tool list) and finalize repo metadata (description, topics, license visible).

**Hardcore tests**
- Full end-to-end run against real staging services: agent checks health, acknowledges a real alert, requests a real restart, human confirms, real restart happens, audit log reflects it accurately.
- Load test the deployed backend at a realistic concurrent-session count and confirm no degradation in confirmation-token correctness under load (this is the one place where a race condition would be genuinely dangerous).
- Attempt the whole flow from a browser session that is deliberately not authenticated — every step must be rejected, not just the final action.

**Security**
- Confirm HTTPS is enforced end-to-end, no mixed content, valid certificate.
- Confirm CORS is locked to known frontend origin(s), not wildcarded.
- Confirm no verbose stack traces or internal error details leak to API responses in production mode — errors are logged internally, sanitized externally.
- Run a final secrets scan across the full repo history before making it public.
- Confirm rate limiting and auth checks are active in the deployed environment exactly as tested locally (no "works locally, forgot to enable in prod" gap).