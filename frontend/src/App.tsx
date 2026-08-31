import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  Bot,
  RefreshCw,
  Server,
  Shield,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { Service, ServiceHealth, Alert, AuditEntry } from './types';
import { api } from './services/api';
import {
  registerWebMCPTools,
  setConfirmationHandler,
} from './webmcp/registry';
import type { PendingConfirmationRequest } from './webmcp/registry';
import { ServiceCard } from './components/service-card';
import { AlertsPanel } from './components/alerts-panel';
import { AuditPanel } from './components/audit-panel';
import { AgentPlayground } from './components/agent-playground';
import { ConfirmDialog } from './components/confirm-dialog';
import { AICopilot } from './components/ai-copilot';

export function App() {
  const [services, setServices] = useState<Service[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, ServiceHealth>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'agent-console' | 'alerts' | 'audit'>('overview');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmationRequest | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // WebMCP registration lifecycle
  useEffect(() => {
    const unregister = registerWebMCPTools();
    setConfirmationHandler((req) => {
      setPendingConfirmation(req);
    });

    return () => {
      unregister();
      setConfirmationHandler(null);
    };
  }, []);

  // Fetch all live data
  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const servicesList = await api.listServices();
      setServices(servicesList);

      const healthPromises = servicesList.map(async (s: Service) => {
        try {
          const h = await api.getServiceHealth(s.id);
          return { id: s.id, health: h };
        } catch {
          return {
            id: s.id,
            health: {
              serviceId: s.id,
              serviceName: s.name,
              status: 'down' as const,
              errorRate: 100,
              cpuUsage: 0,
              memoryUsage: 0,
              uptime: '0s',
              uptimeSec: 0,
              activeAlerts: 1,
              checkedAt: new Date().toISOString(),
              isReachable: false,
            },
          };
        }
      });

      const healthResults = await Promise.all(healthPromises);
      const newHealthMap: Record<string, ServiceHealth> = {};
      healthResults.forEach(({ id, health }) => {
        newHealthMap[id] = health;
      });
      setHealthMap(newHealthMap);

      const alertsList = await api.listAlerts();
      setAlerts(alertsList);

      const auditData = await api.listAuditLogs(30, 0);
      setAuditEntries(auditData.entries || []);
      setAuditTotal(auditData.total || 0);
    } catch {
      // Backend may be starting up
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Auto-poll every 4 seconds
  useEffect(() => {
    let isMounted = true;
    const poll = () => {
      if (isMounted) {
        refreshData();
      }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [refreshData]);

  // Restart Service Action (Human initiated with Guardrail confirmation)
  const handleRestartService = async (serviceId: string) => {
    try {
      const resp = await api.executeAction(serviceId, 'restart_service', {}, 'Operator initiated manual restart', undefined, 'human');
      if (resp.status === 'confirmation_required' && resp.requiredConfirmation) {
        setPendingConfirmation({
          challenge: resp.requiredConfirmation,
          onApprove: async (token: string) => {
            setPendingConfirmation(null);
            const execResp = await api.executeAction(serviceId, 'restart_service', {}, 'Operator approved restart', token, 'human');
            showNotification('success', execResp.message || 'Restart initiated');
            refreshData();
          },
          onReject: () => {
            setPendingConfirmation(null);
            showNotification('error', 'Restart action was cancelled');
            refreshData();
          },
        });
      } else {
        showNotification('success', resp.message);
        refreshData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Restart failed';
      showNotification('error', msg);
    }
  };

  // Scale Service Action (Human initiated with Guardrail confirmation)
  const handleScaleService = async (serviceId: string, replicas: number) => {
    try {
      const resp = await api.executeAction(
        serviceId,
        'scale_service',
        { replicas },
        `Operator scaling instances to ${replicas}`,
        undefined,
        'human'
      );
      if (resp.status === 'confirmation_required' && resp.requiredConfirmation) {
        setPendingConfirmation({
          challenge: resp.requiredConfirmation,
          onApprove: async (token: string) => {
            setPendingConfirmation(null);
            const execResp = await api.executeAction(
              serviceId,
              'scale_service',
              { replicas },
              `Operator approved scaling to ${replicas}`,
              token,
              'human'
            );
            showNotification('success', execResp.message || 'Scaling applied');
            refreshData();
          },
          onReject: () => {
            setPendingConfirmation(null);
            showNotification('error', 'Scale action was cancelled');
            refreshData();
          },
        });
      } else {
        showNotification('success', resp.message);
        refreshData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scale failed';
      showNotification('error', msg);
    }
  };

  // Acknowledge alert
  const handleAcknowledgeAlert = async (alertId: string, reason?: string) => {
    try {
      const resp = await api.acknowledgeAlert(alertId, 'operator', reason);
      showNotification('success', resp.message || 'Alert acknowledged');
      refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to acknowledge alert';
      showNotification('error', msg);
    }
  };

  // Add incident note
  const handleAddIncidentNote = async (alertId: string, content: string) => {
    try {
      const resp = await api.addIncidentNote(alertId, 'operator', content);
      showNotification('success', resp.message || 'Incident note added');
      refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add incident note';
      showNotification('error', msg);
    }
  };

  const firingAlerts = alerts.filter((a: Alert) => a.status === 'firing');
  const degradedServices = services.filter((s: Service) => {
    const h = healthMap[s.id];
    return h?.status === 'degraded' || h?.status === 'down' || h?.status === 'unhealthy';
  });

  const isAllHealthy = degradedServices.length === 0 && firingAlerts.length === 0;

  return (
    <div className="min-h-screen bg-white text-[#1D1D1F] pb-16">
      {/* 2-Second Hero Status Banner */}
      <div
        className={`border-b transition-colors px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-4 ${
          isAllHealthy
            ? 'bg-[#EAF9EE] border-[#B6E8C2] text-[#248A3D]'
            : 'bg-[#FFF6E8] border-[#FFE1B0] text-[#B26B00]'
        }`}
      >
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAllHealthy ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#34C759]" />
                <span>All systems operational — {services.length} services healthy, 0 active alerts</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-[#FF9F0A]" />
                <span>
                  {degradedServices.length > 0
                    ? `${degradedServices.length} service requires attention: ${degradedServices.map((s) => s.name).join(', ')}`
                    : `${firingAlerts.length} active incident alert firing`}
                </span>
              </>
            )}
          </div>

          <span className="text-[11px] font-normal text-[#6E6E73] hidden sm:inline">
            Live telemetry auto-polling active
          </span>
        </div>
      </div>

      {/* Main Header */}
      <header className="border-b border-[#D2D2D7] bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-[#1D1D1F]">Ops Co-pilot</h1>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EBF4FF] text-[#0071E3] border border-[#BCD9FF]">
                  WebMCP Active
                </span>
              </div>
              <p className="text-xs text-[#6E6E73]">Infrastructure Observability & Agent Guardrails</p>
            </div>
          </div>

          {/* Navigation Segmented Control */}
          <div className="flex items-center gap-1 bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-white text-[#1D1D1F] font-semibold shadow-xs border border-[#D2D2D7]'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F]'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              Services ({services.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'alerts'
                  ? 'bg-white text-[#1D1D1F] font-semibold shadow-xs border border-[#D2D2D7]'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F]'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-[#FF9F0A]" />
              Alerts
              {firingAlerts.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#FF3B30] text-white font-bold">
                  {firingAlerts.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-white text-[#1D1D1F] font-semibold shadow-xs border border-[#D2D2D7]'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F]'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-[#6E6E73]" />
              Audit Log ({auditTotal})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('agent-console')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'agent-console'
                  ? 'bg-white text-[#1D1D1F] font-semibold shadow-xs border border-[#D2D2D7]'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F]'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-[#0071E3]" />
              WebMCP Agent Console
            </button>
          </div>

          {/* Refresh Action */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshData}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-[#F5F5F7] hover:bg-[#E5E5EA] border border-[#D2D2D7] text-[#1D1D1F] transition-colors cursor-pointer"
              title="Refresh telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#0071E3]' : 'text-[#6E6E73]'}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 animate-fade-in">
          <div
            className={`px-4 py-3 rounded-2xl border text-xs font-semibold shadow-lg flex items-center gap-2 bg-white ${
              notification.type === 'success'
                ? 'border-[#34C759] text-[#248A3D]'
                : 'border-[#FF3B30] text-[#FF3B30]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                notification.type === 'success' ? 'bg-[#34C759]' : 'bg-[#FF3B30]'
              }`}
            />
            {notification.message}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {services.map((svc: Service) => (
                <ServiceCard
                  key={svc.id}
                  service={svc}
                  health={healthMap[svc.id]}
                  onRestart={handleRestartService}
                  onScale={handleScaleService}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <AlertsPanel
                alerts={alerts}
                onAcknowledge={handleAcknowledgeAlert}
                onAddNote={handleAddIncidentNote}
              />
              <AuditPanel
                entries={auditEntries}
                total={auditTotal}
                onRefresh={refreshData}
              />
            </div>
          </div>
        )}

        {/* Tab 2: Alerts Focus */}
        {activeTab === 'alerts' && (
          <AlertsPanel
            alerts={alerts}
            onAcknowledge={handleAcknowledgeAlert}
            onAddNote={handleAddIncidentNote}
          />
        )}

        {/* Tab 3: Audit Log Focus */}
        {activeTab === 'audit' && (
          <AuditPanel
            entries={auditEntries}
            total={auditTotal}
            onRefresh={refreshData}
          />
        )}

        {/* Tab 4: WebMCP Agent Console */}
        {activeTab === 'agent-console' && (
          <AgentPlayground onActionCompleted={refreshData} />
        )}
      </main>

      {/* Human-in-the-Loop Confirmation Dialog Modal */}
      {pendingConfirmation && (
        <ConfirmDialog
          challenge={pendingConfirmation.challenge}
          onApprove={pendingConfirmation.onApprove}
          onReject={pendingConfirmation.onReject}
        />
      )}

      {/* Interactive In-App WebMCP AI Copilot Agent Drawer */}
      <AICopilot onActionTriggered={refreshData} />
    </div>
  );
}

export default App;
