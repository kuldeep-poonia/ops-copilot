import type {
  Service,
  ServiceHealth,
  Alert,
  AuditEntry,
  ConfirmationChallenge,
  ActionExecutionResponse,
} from '../types';

const AUTH_SECRET = (import.meta.env.VITE_AUTH_SECRET || '').trim();

function getApiBases(): string[] {
  const bases: string[] = [];
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLocal) {
    bases.push('http://localhost:8080/api');
  }

  const rawEnv = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (rawEnv) {
    const formatted = rawEnv.endsWith('/api') ? rawEnv : `${rawEnv}/api`;
    if (!bases.includes(formatted)) bases.push(formatted);
  }

  const defaultProd = 'https://ops-copilot-nspl.onrender.com/api';
  if (!bases.includes(defaultProd)) bases.push(defaultProd);

  return bases;
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const bases = getApiBases();
  let lastError: Error | null = null;

  for (let i = 0; i < bases.length; i++) {
    const url = `${bases[i]}${cleanPath}`;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Session-ID': 'ops-web-session',
        ...(options?.headers as Record<string, string> || {}),
      };

      if (AUTH_SECRET) {
        headers['Authorization'] = `Bearer ${AUTH_SECRET}`;
      }

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (response.status === 428) {
        return response.json() as Promise<T>;
      }

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const data = await response.json();
          if (data.error) errorMsg = data.error;
        } catch {
          // Non-JSON error
        }
        throw new Error(errorMsg);
      }

      return response.json() as Promise<T>;
    } catch (err: unknown) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      lastError = errObj;
      // If it was a network error ("Failed to fetch"), continue loop to next candidate API base
      if (errObj.message.includes('Failed to fetch') && i < bases.length - 1) {
        continue;
      }
      throw errObj;
    }
  }

  throw lastError || new Error('Network request failed across all API endpoints');
}

export const api = {
  async listServices(): Promise<Service[]> {
    const data = await fetchJSON<{ services: Service[] }>('/services');
    return data.services || [];
  },

  async registerService(service: Partial<Service>): Promise<{ status: string; service: Service }> {
    return fetchJSON<{ status: string; service: Service }>('/services', {
      method: 'POST',
      body: JSON.stringify(service),
    });
  },

  async deleteService(serviceId: string): Promise<{ status: string; serviceId: string }> {
    return fetchJSON<{ status: string; serviceId: string }>(`/services/${serviceId}`, {
      method: 'DELETE',
    });
  },

  async getServiceHealth(serviceId: string): Promise<ServiceHealth> {
    return fetchJSON<ServiceHealth>(`/services/${serviceId}/health`);
  },

  async listAlerts(serviceId?: string, status?: string): Promise<Alert[]> {
    const params = new URLSearchParams();
    if (serviceId) params.append('serviceId', serviceId);
    if (status) params.append('status', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    const data = await fetchJSON<{ alerts: Alert[] }>(`/alerts${query}`);
    return data.alerts || [];
  },

  async acknowledgeAlert(alertId: string, actor: string = 'operator', reason?: string): Promise<ActionExecutionResponse> {
    return fetchJSON<ActionExecutionResponse>(`/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ actor, reason }),
    });
  },

  async addIncidentNote(alertId: string, author: string, content: string): Promise<ActionExecutionResponse> {
    return fetchJSON<ActionExecutionResponse>(`/alerts/${alertId}/notes`, {
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
    return fetchJSON<{ entries: AuditEntry[]; total: number }>(`/audit-log?${params.toString()}`);
  },

  async getChallenge(challengeId: string): Promise<ConfirmationChallenge> {
    return fetchJSON<ConfirmationChallenge>(`/challenges/${challengeId}`);
  },

  async reviewChallenge(challengeId: string, approved: boolean, reviewer: string = 'operator'): Promise<{ approved: boolean; confirmationToken?: string; message: string }> {
    return fetchJSON<{ approved: boolean; confirmationToken?: string; message: string }>(`/challenges/${challengeId}/review`, {
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
    return fetchJSON<ActionExecutionResponse>('/actions/execute', {
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
