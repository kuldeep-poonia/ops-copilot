import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  RefreshCw,
  Server,
  Shield,
  Flame,
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

      // Fetch health for each service concurrently
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

  // Inject Chaos on port for testing
  const handleInjectChaos = async (port: number) => {
    try {
      await fetch(`http://127.0.0.1:${port}/chaos/spike`, { method: 'POST' });
      showNotification('success', `Injected CPU spike chaos on port ${port}`);
      setTimeout(refreshData, 1000);
    } catch {
      showNotification('error', `Could not reach service on port ${port}`);
    }
  };

  const firingAlertsCount = alerts.filter((a: Alert) => a.status === 'firing').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-purple-500 selection:text-white pb-16">
      {/* Top Gradient Ribbon */}
      <div className="h-1 bg-gradient-to-r from-purple-500 via-indigo-500 to-amber-500" />

      {/* Main Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-500/20 text-white">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-white">Ops Co-pilot</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  WebMCP Active
                </span>
              </div>
              <p className="text-xs text-slate-400">Agent-Friendly Observability & Human Guardrails</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              Services ({services.length})
            </button>

            <button
              onClick={() => setActiveTab('alerts')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer relative ${
                activeTab === 'alerts'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Alerts
              {firingAlertsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold animate-pulse">
                  {firingAlertsCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              Audit Log ({auditTotal})
            </button>

            <button
              onClick={() => setActiveTab('agent-console')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'agent-console'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-purple-400" />
              WebMCP Agent Console
            </button>
          </div>

          {/* Refresh Action */}
          <div className="flex items-center gap-2">
            <button
              onClick={refreshData}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
              title="Refresh telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 animate-fade-in">
          <div
            className={`px-4 py-3 rounded-xl border text-xs font-semibold shadow-2xl flex items-center gap-2 ${
              notification.type === 'success'
                ? 'bg-slate-900 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-900 border-rose-500/50 text-rose-300'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${notification.type === 'success' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {notification.message}
          </div>
        </div>
      )}

      {/* Main Content Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Chaos Injection Quick Bar */}
        <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <Flame className="w-4 h-4 text-amber-500" />
            <span className="font-semibold text-slate-300">Live Chaos Injection:</span>
            <span>Trigger real-world load spikes to test alert engine and agent remediation</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleInjectChaos(8081)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
            >
              Spike Payment API (Port 8081)
            </button>
            <button
              onClick={() => handleInjectChaos(8082)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
            >
              Spike Auth IAM (Port 8082)
            </button>
          </div>
        </div>

        {/* Tab 1: Overview (Services Cards) */}
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

        {/* Tab 4: WebMCP Agent Test Console */}
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
    </div>
  );
}

export default App;
