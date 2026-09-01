import { api } from '../services/api';
import type { WebMCPTool, ConfirmationChallenge } from '../types';

export interface PendingConfirmationRequest {
  challenge: ConfirmationChallenge;
  onApprove: (token: string) => void;
  onReject: () => void;
}

type ConfirmationHandler = (req: PendingConfirmationRequest) => void;

let globalConfirmationHandler: ConfirmationHandler | null = null;

export function setConfirmationHandler(handler: ConfirmationHandler | null) {
  globalConfirmationHandler = handler;
}

function parseParams(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function createWebMCPTools(): WebMCPTool[] {
  return [
    {
      name: 'get_service_health',
      description: 'Fetch real-time health metrics (CPU usage, memory pressure, error rate, uptime, and status) for a specific registered service.',
      tier: 'read-only',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: {
            type: 'string',
            description: 'The unique identifier of the monitored service (e.g. srv-daamgkon74is73bduu30, payment-service, or social-mcp)',
          },
        },
        required: ['serviceId'],
      },
      execute: async (rawParams: unknown) => {
        const params = parseParams(rawParams);
        const serviceId = String(params.serviceId || 'srv-daamgkon74is73bduu30');
        return await api.getServiceHealth(serviceId);
      },
    },
    {
      name: 'list_active_alerts',
      description: 'List current firing or acknowledged infrastructure and service alerts with severity levels, thresholds, and triage notes.',
      tier: 'read-only',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: {
            type: 'string',
            description: 'Optional service ID to filter alerts for a specific service only',
          },
          status: {
            type: 'string',
            description: 'Optional filter by alert status: firing, acknowledged, or resolved',
            enum: ['firing', 'acknowledged', 'resolved'],
          },
        },
      },
      execute: async (rawParams: unknown) => {
        const params = parseParams(rawParams);
        const serviceId = params.serviceId ? String(params.serviceId) : undefined;
        const status = params.status ? String(params.status) : undefined;
        return await api.listAlerts(serviceId, status);
      },
    },
    {
      name: 'get_audit_log',
      description: 'Retrieve the immutable audit trail of operational actions taken by AI agents and human operators.',
      tier: 'read-only',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: {
            type: 'string',
            description: 'Optional service ID to filter audit records',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of audit entries to return (default: 20)',
          },
        },
      },
      execute: async (rawParams: unknown) => {
        const params = parseParams(rawParams);
        const limit = typeof params.limit === 'number' ? params.limit : 20;
        const serviceId = params.serviceId ? String(params.serviceId) : undefined;
        return await api.listAuditLogs(limit, 0, serviceId);
      },
    },
    {
      name: 'acknowledge_alert',
      description: 'Acknowledge an active alert to signal that triage is underway. This is a low-risk, reversible action that executes immediately.',
      tier: 'low-risk',
      inputSchema: {
        type: 'object',
        properties: {
          alertId: {
            type: 'string',
            description: 'The unique alert ID to acknowledge (e.g. alt-12345678)',
          },
          reason: {
            type: 'string',
            description: 'Explanation or triage note for why this alert is being acknowledged',
          },
        },
        required: ['alertId'],
      },
      execute: async (rawParams: unknown) => {
        const params = parseParams(rawParams);
        const alertId = String(params.alertId || '');
        const reason = params.reason ? String(params.reason) : undefined;
        return await api.acknowledgeAlert(alertId, 'agent', reason);
      },
    },
    {
      name: 'add_incident_note',
      description: 'Append an operational note or diagnostic hypothesis to an ongoing alert. This is a low-risk action that executes immediately.',
      tier: 'low-risk',
      inputSchema: {
        type: 'object',
        properties: {
          alertId: {
            type: 'string',
            description: 'The ID of the alert to attach the note to',
          },
          content: {
            type: 'string',
            description: 'The diagnostic finding, remediation step, or context to record',
          },
        },
        required: ['alertId', 'content'],
      },
      execute: async (rawParams: unknown) => {
        const params = parseParams(rawParams);
        const alertId = String(params.alertId || '');
        const content = String(params.content || '');
        return await api.addIncidentNote(alertId, 'agent', content);
      },
    },
    {
      name: 'restart_service',
      description: 'High-risk action: Initiates a graceful restart of a monitored service. Structural safety requires explicit human confirmation via on-screen dialog before execution.',
      tier: 'high-risk',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: {
            type: 'string',
            description: 'The ID of the service to restart',
          },
          reason: {
            type: 'string',
            description: 'Clear technical rationale for why restarting this service is necessary',
          },
        },
        required: ['serviceId', 'reason'],
      },
      execute: async (rawParams: unknown) => {
        const params = parseParams(rawParams);
        const serviceId = String(params.serviceId || 'srv-daamgkon74is73bduu30');
        const reason = String(params.reason || 'Agent requested restart');

        // Step 1: Request initial execution without token -> backend generates challenge
        const initialResp = await api.executeAction(serviceId, 'restart_service', {}, reason, undefined, 'agent');

        if (initialResp.status === 'confirmation_required' && initialResp.requiredConfirmation) {
          if (!globalConfirmationHandler) {
            throw new Error('Human confirmation UI is not active. High-risk action blocked.');
          }

          // Step 2: Trigger human interaction flow in browser
          const token = await new Promise<string>((resolve, reject) => {
            globalConfirmationHandler!({
              challenge: initialResp.requiredConfirmation!,
              onApprove: (issuedToken) => resolve(issuedToken),
              onReject: () => reject(new Error('Action was rejected by human operator.')),
            });
          });

          // Step 3: Execute with verified single-use token
          return await api.executeAction(serviceId, 'restart_service', {}, reason, token, 'agent');
        }

        return initialResp;
      },
    },
    {
      name: 'scale_service',
      description: 'High-risk action: Adjusts the replica count for a service. Structural safety requires explicit human confirmation via on-screen dialog before execution.',
      tier: 'high-risk',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: {
            type: 'string',
            description: 'The ID of the service to scale',
          },
          replicas: {
            type: 'number',
            description: 'The target replica count (must be within service min/max boundaries)',
          },
          reason: {
            type: 'string',
            description: 'Technical justification for the replica adjustment',
          },
        },
        required: ['serviceId', 'replicas', 'reason'],
      },
      execute: async (rawParams: unknown) => {
        const params = parseParams(rawParams);
        const serviceId = String(params.serviceId || 'srv-daamgkon74is73bduu30');
        const replicas = Number(params.replicas) || 1;
        const reason = String(params.reason || 'Agent requested scale adjustment');

        const initialResp = await api.executeAction(serviceId, 'scale_service', { replicas }, reason, undefined, 'agent');

        if (initialResp.status === 'confirmation_required' && initialResp.requiredConfirmation) {
          if (!globalConfirmationHandler) {
            throw new Error('Human confirmation UI is not active. High-risk action blocked.');
          }

          const token = await new Promise<string>((resolve, reject) => {
            globalConfirmationHandler!({
              challenge: initialResp.requiredConfirmation!,
              onApprove: (issuedToken) => resolve(issuedToken),
              onReject: () => reject(new Error('Action was rejected by human operator.')),
            });
          });

          return await api.executeAction(serviceId, 'scale_service', { replicas }, reason, token, 'agent');
        }

        return initialResp;
      },
    },
  ];
}

// Register all tools onto document.modelContext and window.modelContext per WebMCP spec
export function registerWebMCPTools(): () => void {
  const tools = createWebMCPTools();

  const doc = document as unknown as {
    modelContext?: {
      registerTool?: (tool: WebMCPTool) => void;
      unregisterTool?: (name: string) => void;
      tools?: Record<string, WebMCPTool>;
    };
  };

  const win = window as unknown as {
    modelContext?: {
      registerTool?: (tool: WebMCPTool) => void;
      unregisterTool?: (name: string) => void;
      tools?: Record<string, WebMCPTool>;
    };
  };

  const initContext = (target: { modelContext?: { registerTool?: (tool: WebMCPTool) => void; unregisterTool?: (name: string) => void; tools?: Record<string, WebMCPTool> } }) => {
    if (!target.modelContext) {
      target.modelContext = {
        tools: {},
        registerTool: (tool: WebMCPTool) => {
          if (target.modelContext?.tools) {
            target.modelContext.tools[tool.name] = tool;
          }
        },
        unregisterTool: (name: string) => {
          if (target.modelContext?.tools) {
            delete target.modelContext.tools[name];
          }
        },
      };
    }
  };

  initContext(doc);
  initContext(win);

  tools.forEach((tool) => {
    doc.modelContext?.registerTool?.(tool);
    win.modelContext?.registerTool?.(tool);
  });

  // Cleanup function on unmount
  return () => {
    tools.forEach((tool) => {
      doc.modelContext?.unregisterTool?.(tool.name);
      win.modelContext?.unregisterTool?.(tool.name);
    });
  };
}
