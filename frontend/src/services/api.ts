import type {
  Service,
  ServiceHealth,
  Alert,
  AuditEntry,
  ConfirmationChallenge,
  ActionExecutionResponse,
} from '../types';

const rawApiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8080/api').trim().replace(/\/+$/, '');
const API_BASE = rawApiUrl.endsWith('/api') ? rawApiUrl : `${rawApiUrl}/api`;
const AUTH_SECRET = import.meta.env.VITE_AUTH_SECRET || 'dev-secret-key-must-be-at-least-32-chars-long!';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_SECRET}`,
      'X-Session-ID': 'ops-web-session',
      ...(options?.headers || {}),
    },
  });

  // HTTP 428 Precondition Required carries a valid confirmation challenge response
  if (response.status === 428) {
    return response.json() as Promise<T>;
  }

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const data = await response.json();
      if (data.error) {
        errorMsg = data.error;
      }
    } catch {
      // Ignored if non-JSON error
    }
    throw new Error(errorMsg);
  }

  return response.json() as Promise<T>;
}

export const api = {
  async listServices(): Promise<Service[]> {
    const data = await fetchJSON<{ services: Service[] }>(`${API_BASE}/services`);
    return data.services || [];
  },

  async getServiceHealth(serviceId: string): Promise<ServiceHealth> {
    return fetchJSON<ServiceHealth>(`${API_BASE}/services/${serviceId}/health`);
  },

  async listAlerts(serviceId?: string, status?: string): Promise<Alert[]> {
    const params = new URLSearchParams();
    if (serviceId) params.append('serviceId', serviceId);
    if (status) params.append('status', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    const data = await fetchJSON<{ alerts: Alert[] }>(`${API_BASE}/alerts${query}`);
    return data.alerts || [];
  },

  async acknowledgeAlert(alertId: string, actor: string = 'operator', reason?: string): Promise<ActionExecutionResponse> {
    return fetchJSON<ActionExecutionResponse>(`${API_BASE}/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ actor, reason }),
    });
  },

  async addIncidentNote(alertId: string, author: string, content: string): Promise<ActionExecutionResponse> {
    return fetchJSON<ActionExecutionResponse>(`${API_BASE}/alerts/${alertId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ author, content }),
    });
  },

  async listAuditLogs(limit: number = 50, offset: number = 0, serviceId?: string): Promise<{ entries: AuditEntry[]; total: number }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (serviceId) params.append('serviceId', serviceId);
    return fetchJSON<{ entries: AuditEntry[]; total: number }>(`${API_BASE}/audit-log?${params.toString()}`);
  },

  async getChallenge(challengeId: string): Promise<ConfirmationChallenge> {
    return fetchJSON<ConfirmationChallenge>(`${API_BASE}/challenges/${challengeId}`);
  },

  async reviewChallenge(challengeId: string, approved: boolean, reviewer: string = 'operator'): Promise<{ approved: boolean; confirmationToken?: string; message: string }> {
    return fetchJSON<{ approved: boolean; confirmationToken?: string; message: string }>(`${API_BASE}/challenges/${challengeId}/review`, {
      method: 'POST',
      body: JSON.stringify({ challengeId, approved, reviewer }),
    });
  },

  async executeAction(
    serviceId: string,
    actionType: string,
    parameters: Record<string, unknown> = {},
    reason: string = '',
    confirmationToken?: string,
    initiator: string = 'human'
  ): Promise<ActionExecutionResponse> {
    return fetchJSON<ActionExecutionResponse>(`${API_BASE}/actions/execute`, {
      method: 'POST',
      body: JSON.stringify({
        serviceId,
        actionType,
        parameters,
        reason,
        confirmationToken,
        initiator,
      }),
    });
  },
};
