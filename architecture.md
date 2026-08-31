# Ops Co-pilot — Architecture

## 1. Design Goals

- **Correctness over cleverness.** Every tool call must reflect real backend state, never cached or synthetic data pretending to be live.
- **Safety by construction, not by convention.** High-risk actions must be structurally impossible to execute without human confirmation — this is enforced server-side, not just in the UI.
- **Pluggable data source.** The monitoring backend must not be hard-wired to one specific stack (e.g., Prometheus). It talks to an internal interface; today's implementation may be a lightweight self-hosted metrics collector, but swapping in Prometheus, Datadog, or CloudWatch later should require changing one adapter, not the rest of the system.
- **Small, composable WebMCP tools.** Each tool does one thing. Agents reason better over several narrow tools with precise schemas than over one broad "do everything" tool.
- **Auditable by default.** Every state-changing action, regardless of who triggered it, is logged with actor, timestamp, and reason.

## 2. High-Level System Map

```
┌─────────────────────────────┐
│      Browser (agent-capable)│
│  ┌────────────────────────┐ │
│  │  React Dashboard        │ │
│  │  - status views          │ │
│  │  - confirmation dialog   │ │
│  │  - WebMCP tool registry  │ │◄──── AI Agent (ChatGPT / Claude / etc.)
│  └───────────┬──────────────┘ │       calls registered tools directly
└──────────────┼────────────────┘
               │ HTTPS / JSON
               ▼
┌──────────────────────────────────────┐
│              Go Backend               │
│  ┌────────────┐  ┌──────────────────┐ │
│  │ API layer   │  │ Guardrail layer   │ │
│  │ (REST)      │  │ (confirmation     │ │
│  │             │  │  tokens, auth)    │ │
│  └─────┬───────┘  └────────┬──────────┘ │
│        │                    │            │
│  ┌─────▼────────────────────▼─────────┐ │
│  │      Service Orchestration Core     │ │
│  │  - health aggregation                │ │
│  │  - alert engine                      │ │
│  │  - action executor                   │ │
│  │  - audit log writer                  │ │
│  └─────┬─────────────────────┬──────────┘ │
└────────┼─────────────────────┼─────────────┘
         │                     │
         ▼                     ▼
┌────────────────┐    ┌───────────────────┐
│ Metrics Adapter  │    │  Real monitored    │
│ (interface;       │    │  services           │
│  Prometheus/other)│    │  (restart/scale via  │
│                    │    │  their own APIs)     │
└────────────────┘    └───────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │  Postgres/SQLite  │
        │  - alert state     │
        │  - audit log        │
        │  - confirmation     │
        │    tokens           │
        └─────────────────┘
```

## 3. Component Breakdown

### 3.1 React Dashboard (frontend)

- Renders live service status by polling/subscribing to the backend.
- Registers all WebMCP tools on mount via `document.modelContext.registerTool`, unregisters on unmount (no ghost tools).
- Owns the confirmation dialog UI: when a high-risk tool call comes in, the backend flags it as pending, the frontend surfaces `requestUserInteraction`, and the person sees a clear, specific description of the proposed action (service name, action type, agent's stated reason) before approving or rejecting.
- Never trusts the agent's framing at face value — the dialog always shows the actual parameters that will be sent to the backend, not just the agent's natural-language summary.

### 3.2 Go Backend — API Layer

- Thin REST layer. Validates every request against a strict schema before touching any business logic. Rejects malformed input with a clear error rather than attempting to coerce it.
- Every endpoint requires an authenticated session (see Security, section 5). WebMCP tool calls carry the same session context as the browser tab they originate from — there is no separate, less-guarded path for agent-originated requests.

### 3.3 Service Orchestration Core

- **Health aggregation:** normalizes data from the metrics adapter into a consistent shape (`status`, `error_rate`, `cpu`, `memory`, `active_alerts`, `last_action`) regardless of underlying data source.
- **Alert engine:** evaluates thresholds, creates/updates alert records, assigns severity. Severity determines which tier a related action falls into (informational vs. requires-confirmation).
- **Action executor:** the only component allowed to actually call out to a real service's control API (restart, scale, etc.). It never executes a high-risk action without first checking for a valid, unexpired, single-use confirmation token tied to that exact action and its exact parameters.
- **Audit log writer:** appends an immutable record for every action attempt (not just successes) — actor (`agent` or `human:<user_id>`), action, parameters, timestamp, result.

### 3.4 Metrics Adapter (interface boundary)

- Defined as a Go interface (`MetricsSource`) with methods like `GetServiceHealth(service string) (Health, error)` and `ListAlerts() ([]Alert, error)`.
- The concrete implementation used at runtime (e.g., a Prometheus client, or a lightweight self-reported metrics collector for smaller deployments) is chosen at startup via configuration, not hard-coded into the orchestration core.
- This means the core logic — alerting, guardrails, audit — is identical regardless of what's actually being monitored.

### 3.5 Data Store

- Postgres in production, SQLite acceptable for a small/local deployment. Same schema either way (kept simple enough that this is a non-issue).
- Stores: alert state, audit log, active confirmation tokens, service registry (which services exist and how to reach their control APIs).

## 4. WebMCP Tool Layer — Tiering Model

Tools are explicitly grouped into three trust tiers. This grouping is a first-class part of the design, not an afterthought:

| Tier | Examples | Execution rule |
|---|---|---|
| Read-only | `get_service_health`, `list_active_alerts`, `get_audit_log` | Executes immediately, no side effects possible. |
| Low-risk / reversible | `acknowledge_alert`, `add_incident_note` | Executes immediately, but is fully logged and trivially reversible (undo = re-flag/edit note). |
| High-risk / irreversible-or-impactful | `restart_service`, `scale_service` | Never executes on first call. Returns a "confirmation required" response; only executes after the backend receives a valid confirmation token generated by a real human interaction. |

Every tool's `description` field is written specifically so the agent knows *when* to reach for it, not just what it does — this materially affects how reliably the agent picks the right tool.

## 5. Security Architecture

- **Authentication:** every session (browser tab, and by extension every WebMCP tool call originating from it) is tied to an authenticated user via a signed session token. No anonymous write access, ever.
- **Authorization:** actions are scoped to services the authenticated user is actually permitted to operate on — the backend checks this on every action call, not just at login.
- **Confirmation tokens:** generated server-side only after a real `requestUserInteraction` completes in the browser, single-use, short expiry (e.g., 60 seconds), bound to the exact action + exact parameters they were issued for. A token issued for "restart service A" cannot be replayed for "restart service B" or reused twice.
- **No client-trusted confirmation:** the frontend dialog is a UX surface, not the security boundary. The backend independently verifies the token; a compromised or modified frontend cannot forge approval.
- **Input validation everywhere:** every tool input and every REST body is validated against a strict schema before it reaches business logic — reject, don't sanitize-and-guess.
- **Origin restriction:** WebMCP tools are only exposed to the dashboard's own origin and explicitly trusted agent contexts, per the WebMCP permissions model — no wildcard exposure.
- **Least-privilege service control:** the action executor's credentials for calling real services' restart/scale APIs are scoped as narrowly as those APIs allow — never a broad admin credential reused across unrelated systems.
- **Secrets management:** all credentials (service control API keys, DB connection strings) come from environment/secret manager, never committed, never logged.
- **Rate limiting:** per-user and per-tool rate limits prevent an agent (misbehaving or otherwise) from hammering the action executor or the underlying real services.
- **Full audit trail:** every action attempt, approved or rejected, successful or failed, is logged with enough detail to reconstruct exactly what happened and who authorized it.

## 6. Error Handling Strategy

- Every external call (metrics adapter, real service control API) has an explicit timeout and a defined failure behavior — the dashboard shows "unknown/unreachable," never a false "healthy."
- Tool `execute` functions always return a structured result, including on failure, so the agent gets a clear, actionable error rather than a silent no-op.
- Partial failures (e.g., 2 of 3 services reachable) are surfaced as partial data with a clear flag, never silently dropped.