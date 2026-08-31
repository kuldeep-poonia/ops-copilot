# Ops Co-pilot — Product Overview

## What it is

Ops Co-pilot is a web-based infrastructure monitoring dashboard that exposes its data and actions as WebMCP tools, so that an AI agent operating in the same browser session can check service health, triage alerts, and take operational actions directly — without screen-scraping the UI or guessing at button locations. Low-risk actions the agent can take on its own. Actions that could cause real damage or downtime always require an explicit human confirmation before they execute.

It is built for one specific moment: a person asks their agent "is everything okay?" or "can you fix this?" and the agent can actually answer with real, structured, current data — and act, safely — instead of describing what it would need a human to go check.

## What it does

- Displays live health status (error rate, CPU, memory, uptime, active alerts) for each monitored service.
- Exposes that same data to an AI agent as structured WebMCP tools, so the agent can query it directly instead of interpreting a screenshot or the page's DOM.
- Lets the agent take low-risk, reversible actions on its own: acknowledging an alert, adding an incident note, pulling logs.
- Requires explicit human confirmation, via a real on-screen dialog, before any high-risk action executes: restarting a service, scaling replicas, or anything else that affects a live system.
- Keeps a visible, human-readable log of every action taken — whether by a person or by an agent — so there's always a clear record of who did what and why.
- Works with real monitored services and real metrics sources. There is no simulated or fabricated data path in the product itself.

## What it does NOT do

- It does not let an agent take an irreversible or high-impact action without a human explicitly approving that specific action, every time. There is no "auto-approve" mode and no way for an agent to bypass the confirmation step by calling a lower-level endpoint directly.
- It does not replace a full observability stack (it is not Prometheus, Grafana, or a paging system) — it is a thin, agent-friendly control layer on top of monitoring data that already exists.
- It does not manage infrastructure provisioning, deployments, or CI/CD. Scope is limited to monitoring and operating already-running services.
- It does not store or process any personal or customer data. Everything it touches is service/infrastructure metadata (metrics, logs, alert state).
- It does not make autonomous decisions about production changes without a human in the loop for anything that isn't trivially reversible.

## How it works

1. A person opens the Ops Co-pilot dashboard in an agent-capable browser (e.g., ChatGPT's in-app browser, or Chrome with WebMCP enabled).
2. The page registers its WebMCP tools on load (read-only tools like `get_service_health`, low-risk action tools like `acknowledge_alert`, and high-risk action tools like `restart_service`).
3. The agent, acting on the person's request, calls the relevant tool(s). Read and low-risk tools execute immediately and return real data or take the real (reversible) action.
4. If the agent calls a high-risk tool, the backend does not execute the action yet — it triggers a confirmation dialog in the browser (via the WebMCP `requestUserInteraction` flow). The person sees exactly what the agent wants to do and why, and explicitly approves or rejects it.
5. Only after explicit approval does the backend execute the action against the real service and return the result to the agent, which reports back to the person in plain language.
6. Every action — agent-initiated or human-initiated — is written to an audit log visible on the dashboard.