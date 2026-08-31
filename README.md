# Ops Co-pilot

Ops Co-pilot is a web-based infrastructure monitoring dashboard and operational control platform that exposes live service telemetry and remediation actions as structured WebMCP tools for browser-based AI agents. It enforces structural server-side guardrails and human confirmation before executing any high-risk changes (like service restarts or scaling).

---

## Key Features

- **Live Infrastructure Telemetry**: Real-time aggregation of CPU load, memory pressure, error rates, uptime, and active alerts across monitored services.
- **First-Class WebMCP Integration**: Standard in-browser tool registration (`window.modelContext`) enabling AI agents (e.g. ChatGPT, Claude) to query telemetry and initiate actions without brittle DOM scraping.
- **Safety by Construction**: High-risk actions (`restart_service`, `scale_service`) require cryptographic single-use confirmation tokens generated only after explicit human on-screen interaction.
- **Deterministic Alert Engine**: Threshold-based evaluation with flapping deduplication, severity prioritization, and collaborative incident note tracking.
- **Immutable Audit Trail**: Append-only operational event logging with automatic secret and credential scrubbing.
- **Pluggable Metrics Interface**: Clean `MetricsSource` Go interface that talks to live HTTP collectors or standard monitoring backends.

---

## WebMCP Tools Reference

All WebMCP tools are registered upon dashboard mount and categorized into explicit safety tiers:

| Tool Name | Safety Tier | Purpose & Description |
|---|---|---|
| `get_service_health` | Read-only | Returns live CPU, memory, error rate, uptime, and status for a specified service. |
| `list_active_alerts` | Read-only | Lists firing and acknowledged alerts with threshold rules, observed values, and incident notes. |
| `get_audit_log` | Read-only | Retrieves the immutable audit log of operational actions taken by agents and humans. |
| `acknowledge_alert` | Low-risk | Acknowledges an active alert to indicate triage is underway (reversible, executed immediately). |
| `add_incident_note` | Low-risk | Appends diagnostic findings, remediation context, or triage hypotheses to an ongoing alert. |
| `restart_service` | High-risk | Initiates a graceful service restart; structurally blocks until confirmed via human modal. |
| `scale_service` | High-risk | Scales service instance replicas; structurally blocks until confirmed via human modal. |

---

## Project Architecture

```
ops-copilot/
├── backend/                  # Go HTTP backend (port 8080)
│   ├── cmd/server/           # Backend entry point
│   ├── cmd/mockservices/     # Live monitored microservices (ports 8081, 8082, 8083)
│   ├── internal/
│   │   ├── alerts/           # Alert engine & flapping deduplication
│   │   ├── api/              # REST handlers, rate limiting, and CORS middleware
│   │   ├── audit/            # Append-only audit logger with secret scrubbing
│   │   ├── config/           # Fail-fast environment configuration loader
│   │   ├── database/         # Pure Go SQLite driver (modernc.org/sqlite) & migrations
│   │   ├── executor/         # Action executor & service control API client
│   │   ├── guardrail/        # Cryptographic confirmation token generator & validator
│   │   ├── metrics/          # MetricsSource interface & HTTP collector
│   │   ├── models/           # Domain data models & API DTOs
│   │   └── registry/         # Service registry and seed configurations
│   └── *_test.go             # Hardcore adversarial & concurrency test suites
│
├── frontend/                 # React + TypeScript + Vite dashboard (port 5173)
│   ├── src/
│   │   ├── components/       # Service Cards, Alerts Panel, Audit Stream, Confirm Dialog
│   │   ├── services/         # API HTTP client
│   │   ├── webmcp/           # WebMCP tool definitions and modelContext registration
│   │   ├── App.tsx           # Dashboard layout and live telemetry poller
│   │   └── index.css         # Dark-mode design system & animations
│   └── package.json
│
├── LICENSE                   # MIT License
└── README.md
```

---

## Getting Started Locally

### Prerequisites
- **Go**: 1.22+ (tested on Go 1.26)
- **Node.js**: 18+ (tested on Node 24)
- **npm**: 9+

### 1. Start the Monitored Microservices
In terminal 1, start the three sample microservices (`payment-service` on 8081, `auth-service` on 8082, `inventory-service` on 8083):
```bash
cd backend
go run ./cmd/mockservices/main.go
```

### 2. Start the Ops Co-pilot Backend
In terminal 2, launch the Go backend server (port 8080):
```bash
cd backend
go run ./cmd/server/main.go
```

### 3. Start the Frontend Dashboard
In terminal 3, start the Vite development server (port 5173):
```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Running Tests

### Backend Unit & Adversarial Tests
Execute all tests including 500-request concurrency, token replay attacks, expiration checks, parameter tampering, and metric sanitization:
```bash
cd backend
go test -v ./...
```

### Go Vet & Linting
```bash
cd backend
go vet ./...
```

### Frontend TypeScript & Bundle Validation
```bash
cd frontend
npm run build
```

---

## Deployment & Production Notes

1. **HTTPS Enforcement**: WebMCP requires a secure browsing context (`https://` or `localhost`).
2. **Environment Variables**: Configure `.env` with a strong 32+ character `OPS_COPILOT_AUTH_SECRET` and appropriate database path.
3. **Database**: The SQLite database file resides at `OPS_COPILOT_DB_PATH` (default: `./data/opscopilot.db`) using WAL mode for concurrent reader efficiency.

---

## License

This project is licensed under the [MIT License](LICENSE).
