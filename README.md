# Ops Co-pilot

> An AI-friendly observability and incident remediation dashboard that allows autonomous web agents to inspect infrastructure telemetry and execute operational actions with cryptographic human-in-the-loop guardrails.

Ops Co-pilot doesn't add its own AI — it gives any AI agent already in your browser a safe, structured way to check on and operate your real infrastructure, with a human always in control of anything risky.

---

## Live Demo
- **Dashboard URL:** [http://localhost:5173](http://localhost:5173) *(Local development)*
- **API Endpoint:** [http://localhost:8080/api](http://localhost:8080/api)

---

## Product Demo

![Ops Co-pilot Live Product Demo](assets/ops-copilot-demo.gif)

---

## What Problem Does It Solve?

When AI agents are given operational control over infrastructure, traditional dashboards either lock them out completely or give them unrestricted write access that risks catastrophic production outages. 

**Ops Co-pilot bridges this gap** by exposing standardized, in-browser WebMCP tools with structural safety tiering:
1. **Read-Only & Low-Risk Tools:** Agents can freely inspect telemetry, list firing alerts, acknowledge incidents, and post diagnostic notes.
2. **High-Risk Guardrails:** Disruptive actions (restarting services, scaling replicas) are intercepted by the backend. The action is paused until an on-screen human operator reviews the technical rationale and approves a single-use, SHA-256 bound cryptographic confirmation token with a 60-second TTL.

---

## How It Works

Here is how a real end-to-end interaction works when someone operates their infrastructure with an AI agent in the browser:

1. **The dashboard registers its tools.** When someone opens the Ops Co-pilot dashboard in an agent-capable browser (ChatGPT's in-app browser, or Chrome with the WebMCP flag enabled), the page registers its WebMCP tools via `document.modelContext.registerTool(...)`. From this point, any AI agent operating in that browser session can see exactly what actions are available — not by reading the page visually, but by reading this structured tool list.

2. **The person asks the agent something in plain language.** For example: *"Is everything okay with my service?"* or *"Restart the payment service, it's throwing errors."*

3. **The agent picks the right tool and calls it.** Based on each tool's `name` and `description`, the agent decides which one fits the request — e.g. `get_service_health` for a status question — and calls it with the required parameters. This reasoning is done entirely by the agent's own model; Ops Co-pilot does not do any of the natural-language understanding itself.

4. **The tool call reaches the real backend.** The tool's `execute` function calls the Go backend's REST API, which in turn queries the real monitored service (its actual `/health` and `/metrics` endpoints) for genuinely current data — never simulated or cached-as-if-live data.

5. **Read and low-risk actions execute immediately and return real results**, which the agent then explains to the person in natural language.

6. **High-risk actions (restart, scale) never execute on the first call.** The backend responds with `428 Precondition Required` and a description of the proposed action. The dashboard shows an on-screen confirmation dialog to the person — not the agent — describing exactly what is about to happen and why. Only if a person explicitly approves does the backend issue a single-use, time-limited confirmation token and actually execute the action.

7. **Every action, agent-initiated or human-initiated, is written to an audit log** visible on the dashboard, so there's always a clear record of who did what.

### Interaction Flow

```mermaid
flowchart TD
    A["👤 Person asks agent a question in plain language"] --> B["🤖 Agent picks the right registered WebMCP tool"]
    B --> C["⚡ Tool calls Go Backend REST API"]
    C --> D["📊 Backend queries real monitored service (/health, /metrics)"]
    D --> E{"Action Risk Assessment"}
    
    E -->|Read / Low-Risk| F["✅ Executes immediately & returns real live data"]
    E -->|High-Risk: Restart / Scale| G["🛡️ Backend returns HTTP 428 Precondition Required"]
    
    G --> H["🖥️ Dashboard displays Human Confirmation Dialog"]
    H --> I{"👤 Human Decision"}
    
    I -->|Approved| J["🔐 Backend issues single-use token (60s TTL) & executes mutation"]
    I -->|Declined / Timed out| K["❌ Action safely cancelled; infrastructure untouched"]
    
    F --> L["🤖 Agent receives result & explains to person in plain English"]
    J --> L
    K --> L
    
    L --> M["📜 Action recorded to Immutable Audit Trail"]
```

---

## WebMCP Tools

Ops Co-pilot exposes 7 real WebMCP tools registered directly onto the browser's `modelContext` (`window.modelContext` / `document.modelContext`). AI agents operating inside the browser session discover and invoke these tools to inspect system state and remediate incidents.

### 1. `get_service_health` (Read-Only)
```javascript
document.modelContext.registerTool({
  name: "get_service_health",
  description: "Fetch real-time health metrics (CPU usage, memory pressure, error rate, uptime, and status) for a specific registered service.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: {
        type: "string",
        description: "The unique identifier of the monitored service (e.g. payment-service, auth-service, inventory-service)"
      }
    },
    required: ["serviceId"]
  },
  execute: async (input) => {
    return await api.getServiceHealth(input.serviceId);
  }
});
```

### 2. `list_active_alerts` (Read-Only)
```javascript
document.modelContext.registerTool({
  name: "list_active_alerts",
  description: "List current firing or acknowledged infrastructure and service alerts with severity levels, thresholds, and triage notes.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: {
        type: "string",
        description: "Optional service ID to filter alerts for a specific service only"
      },
      status: {
        type: "string",
        description: "Optional filter by alert status: firing, acknowledged, or resolved",
        enum: ["firing", "acknowledged", "resolved"]
      }
    }
  },
  execute: async (input) => {
    return await api.listAlerts(input.serviceId, input.status);
  }
});
```

### 3. `get_audit_log` (Read-Only)
```javascript
document.modelContext.registerTool({
  name: "get_audit_log",
  description: "Retrieve the immutable audit trail of operational actions taken by AI agents and human operators.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: {
        type: "string",
        description: "Optional service ID to filter audit records"
      },
      limit: {
        type: "number",
        description: "Maximum number of audit entries to return (default: 20)"
      }
    }
  },
  execute: async (input) => {
    return await api.listAuditLogs(input.limit || 20, 0, input.serviceId);
  }
});
```

### 4. `acknowledge_alert` (Low-Risk Action)
```javascript
document.modelContext.registerTool({
  name: "acknowledge_alert",
  description: "Acknowledge an active alert to signal that triage is underway. This is a low-risk, reversible action that executes immediately.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "The unique alert ID to acknowledge (e.g. alt-12345678)"
      },
      reason: {
        type: "string",
        description: "Explanation or triage note for why this alert is being acknowledged"
      }
    },
    required: ["alertId"]
  },
  execute: async (input) => {
    return await api.acknowledgeAlert(input.alertId, "agent", input.reason);
  }
});
```

### 5. `add_incident_note` (Low-Risk Action)
```javascript
document.modelContext.registerTool({
  name: "add_incident_note",
  description: "Append an operational note or diagnostic hypothesis to an ongoing alert. This is a low-risk action that executes immediately.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "The ID of the alert to attach the note to"
      },
      content: {
        type: "string",
        description: "The diagnostic finding, remediation step, or context to record"
      }
    },
    required: ["alertId", "content"]
  },
  execute: async (input) => {
    return await api.addIncidentNote(input.alertId, "agent", input.content);
  }
});
```

### 6. `restart_service` (High-Risk Action — Human Guardrail Required)
```javascript
document.modelContext.registerTool({
  name: "restart_service",
  description: "High-risk action: Initiates a graceful restart of a monitored service. Structural safety requires explicit human confirmation via on-screen dialog before execution.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: {
        type: "string",
        description: "The ID of the service to restart"
      },
      reason: {
        type: "string",
        description: "Clear technical rationale for why restarting this service is necessary"
      }
    },
    required: ["serviceId", "reason"]
  },
  execute: async (input) => {
    // 1. Initial execution returns HTTP 428 Precondition Required with confirmation challenge
    const initial = await api.executeAction(input.serviceId, "restart_service", {}, input.reason, undefined, "agent");
    
    if (initial.status === "confirmation_required" && initial.requiredConfirmation) {
      // 2. UI prompts human operator to review rationale & approve
      const confirmationToken = await promptHumanApproval(initial.requiredConfirmation);
      // 3. Execution resumes with single-use cryptographic token
      return await api.executeAction(input.serviceId, "restart_service", {}, input.reason, confirmationToken, "agent");
    }
    return initial;
  }
});
```

### 7. `scale_service` (High-Risk Action — Human Guardrail Required)
```javascript
document.modelContext.registerTool({
  name: "scale_service",
  description: "High-risk action: Adjusts the replica count for a service. Structural safety requires explicit human confirmation via on-screen dialog before execution.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: {
        type: "string",
        description: "The ID of the service to scale"
      },
      replicas: {
        type: "number",
        description: "The target replica count (must be within service min/max boundaries)"
      },
      reason: {
        type: "string",
        description: "Technical justification for the replica adjustment"
      }
    },
    required: ["serviceId", "replicas", "reason"]
  },
  execute: async (input) => {
    const initial = await api.executeAction(input.serviceId, "scale_service", { replicas: input.replicas }, input.reason, undefined, "agent");
    
    if (initial.status === "confirmation_required" && initial.requiredConfirmation) {
      const confirmationToken = await promptHumanApproval(initial.requiredConfirmation);
      return await api.executeAction(input.serviceId, "scale_service", { replicas: input.replicas }, input.reason, confirmationToken, "agent");
    }
    return initial;
  }
});
```

---

## Local Setup Instructions

### Prerequisites
- **Go:** `v1.22+`
- **Node.js:** `v18+`
- **npm:** `v9+`

### 1. Environment Configuration
Copy the example environment file or configure `.env`:
```bash
cp .env.example .env
```

Key environment variables in `.env`:
| Variable | Description | Default |
|---|---|---|
| `OPS_COPILOT_PORT` | Backend HTTP API listen port | `8080` |
| `OPS_COPILOT_ENV` | Environment mode (`development`, `staging`, `production`) | `development` |
| `OPS_COPILOT_DB_PATH` | Path to SQLite database file | `./data/opscopilot.db` |
| `OPS_COPILOT_AUTH_SECRET` | Mandatory Bearer token / HMAC secret (minimum 32 chars) | `dev-secret-key-must-be-at-least-32-chars-long!` |
| `OPS_COPILOT_TOKEN_TTL_SECONDS` | Confirmation token expiration window | `60` |
| `OPS_COPILOT_RATE_LIMIT_RPS` | Token bucket refill rate (req/s) | `20` |
| `OPS_COPILOT_RATE_LIMIT_BURST` | Token bucket burst capacity | `40` |
| `OPS_COPILOT_ALLOWED_ORIGINS` | Strict CORS origin whitelist | `http://localhost:5173,http://127.0.0.1:5173` |

### 2. Start Backend Server
In your terminal, start the primary Go REST API and WebMCP server:
```bash
cd backend
go run ./cmd/server/main.go
```

### 3. Start Frontend Dashboard
In a separate terminal, install dependencies and launch the Vite dev server:
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Register Real Services
You can register your real deployed services (Render, AWS, Kubernetes, custom Prometheus endpoints) directly via the authenticated API:

```bash
curl -X POST http://localhost:8080/api/services \
  -H "Authorization: Bearer dev-secret-key-must-be-at-least-32-chars-long!" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-production-service",
    "name": "Production API Gateway",
    "description": "Live production microservice",
    "endpointUrl": "https://my-service.com/metrics",
    "controlApiUrl": "https://my-service.com/control",
    "controlApiKey": "secret-control-key",
    "minReplicas": 1,
    "maxReplicas": 10,
    "replicas": 3
  }'
```

---

## Running Verification Tests

### Backend Unit & Integration Tests
```bash
cd backend
go test -v ./...
```

### Frontend Typechecking & Linter
```bash
cd frontend
npm run lint
npm run build
```

---

## Architecture & Security Highlights

For detailed system topology, WebMCP interaction sequence diagrams, cryptographic state machines, and database entity models, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

- **WebMCP In-Browser Registry:** Standardized tools dynamically discovered and executed by autonomous agents in the browser session.
- **Structural Safety Tiers:** Read-only inspection tools execute freely; high-risk actions (restart, scale) are halted until an authorized human signs off on an on-screen dialog.
- **Cryptographic Token Guardrail:** Human approvals generate single-use, SHA-256 bound HMAC tokens with a 60-second TTL that prevent parameter tampering, replaying, and scope escalation.
- **Immutable Audit Trail:** Append-only ledger with automated secret scrubbing for zero credentials leakage.
- **Layered Defense:** IP token-bucket rate limiting (20 req/s, 40 burst), Bearer auth gating, and origin-locked CORS preflight validation.

---

## License

This project is licensed under the [MIT License](LICENSE).
