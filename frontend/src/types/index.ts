export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'down' | 'restarting';

export interface Service {
  id: string;
  name: string;
  description: string;
  endpointUrl: string;
  controlApiUrl: string;
  controlApiKey?: string;
  currentStatus: ServiceStatus;
  replicas: number;
  minReplicas: number;
  maxReplicas: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceHealth {
  serviceId: string;
  serviceName: string;
  status: ServiceStatus;
  errorRate: number;
  cpuUsage: number;
  memoryUsage: number;
  uptime: string;
  uptimeSec: number;
  activeAlerts: number;
  lastAction?: string;
  checkedAt: string;
  isReachable: boolean;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'firing' | 'acknowledged' | 'resolved';

export interface IncidentNote {
  id: string;
  alertId: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface Alert {
  id: string;
  serviceId: string;
  serviceName: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  metricName: string;
  thresholdValue: number;
  observedValue: number;
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  notes?: IncidentNote[];
}

export interface AuditEntry {
  id: string;
  actor: string;
  actionType: string;
  serviceId: string;
  serviceName: string;
  parameters: string;
  resultStatus: 'success' | 'failed' | 'rejected' | 'confirmation_required';
  errorMessage?: string;
  createdAt: string;
}

export interface ConfirmationChallenge {
  challengeId: string;
  serviceId: string;
  serviceName: string;
  actionType: string;
  parameters: string;
  reason: string;
  initiator: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export interface ActionExecutionResponse {
  success: boolean;
  status: 'executed' | 'confirmation_required' | 'rejected' | 'failed';
  message: string;
  challengeId?: string;
  requiredConfirmation?: ConfirmationChallenge;
  executionResult?: Record<string, unknown>;
}

export interface WebMCPTool {
  name: string;
  description: string;
  tier: 'read-only' | 'low-risk' | 'high-risk';
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}
