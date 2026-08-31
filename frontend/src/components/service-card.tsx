import React, { useState } from 'react';
import {
  Activity,
  Cpu,
  Database,
  RefreshCw,
  Server,
  Layers,
  AlertCircle,
  Zap,
} from 'lucide-react';
import type { Service, ServiceHealth } from '../types';

interface ServiceCardProps {
  service: Service;
  health?: ServiceHealth;
  onRestart: (serviceId: string) => void;
  onScale: (serviceId: string, replicas: number) => void;
  onChaos?: (port: number) => void;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  health,
  onRestart,
  onScale,
}) => {
  const [scaleValue, setScaleValue] = useState<number>(service.replicas);
  const [showScaleModal, setShowScaleModal] = useState<boolean>(false);

  const status = health?.status || service.currentStatus || 'healthy';
  const isHealthy = status === 'healthy';
  const isDegraded = status === 'degraded';
  const isRestarting = status === 'restarting';

  const statusColors = {
    healthy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ring-emerald-500/20',
    degraded: 'bg-amber-500/10 text-amber-400 border-amber-500/30 ring-amber-500/20',
    unhealthy: 'bg-rose-500/10 text-rose-400 border-rose-500/30 ring-rose-500/20',
    down: 'bg-rose-950/60 text-rose-300 border-rose-700/50 ring-rose-600/20',
    restarting: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 ring-cyan-500/20',
  };

  const statusBadge = statusColors[status as keyof typeof statusColors] || statusColors.healthy;

  return (
    <div className="bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-xl transition-all duration-300 backdrop-blur-md relative overflow-hidden group">
      {/* Subtle Glow Backdrop */}
      <div
        className={`absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl opacity-20 transition-all ${
          isHealthy ? 'bg-emerald-500' : isDegraded ? 'bg-amber-500' : isRestarting ? 'bg-cyan-500' : 'bg-rose-500'
        }`}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-slate-800/80 border border-slate-700 text-indigo-400">
              <Server className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">{service.name}</h3>
              <p className="text-xs text-slate-400 font-mono">{service.id}</p>
            </div>
          </div>
        </div>

        {/* Status Pill */}
        <div className={`px-2.5 py-1 rounded-full border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 shadow-sm ${statusBadge}`}>
          <span className={`w-2 h-2 rounded-full ${isRestarting ? 'bg-cyan-400 animate-spin' : isHealthy ? 'bg-emerald-400 animate-pulse' : isDegraded ? 'bg-amber-400' : 'bg-rose-400'}`} />
          {status}
        </div>
      </div>

      <p className="text-xs text-slate-400 mb-5 line-clamp-2">{service.description}</p>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {/* CPU */}
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" /> CPU Load
            </span>
            <span className="font-mono font-semibold text-slate-200">
              {health?.cpuUsage !== undefined ? `${health.cpuUsage.toFixed(1)}%` : '---'}
            </span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                (health?.cpuUsage || 0) > 85 ? 'bg-rose-500' : (health?.cpuUsage || 0) > 70 ? 'bg-amber-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${Math.min(100, health?.cpuUsage || 0)}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-cyan-400" /> Memory
            </span>
            <span className="font-mono font-semibold text-slate-200">
              {health?.memoryUsage !== undefined ? `${health.memoryUsage.toFixed(1)}%` : '---'}
            </span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                (health?.memoryUsage || 0) > 85 ? 'bg-rose-500' : (health?.memoryUsage || 0) > 75 ? 'bg-amber-500' : 'bg-cyan-500'
              }`}
              style={{ width: `${Math.min(100, health?.memoryUsage || 0)}%` }}
            />
          </div>
        </div>

        {/* Error Rate */}
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-rose-400" /> Error Rate
            </span>
            <span className={`font-mono font-semibold ${(health?.errorRate || 0) > 2 ? 'text-rose-400' : 'text-slate-200'}`}>
              {health?.errorRate !== undefined ? `${health.errorRate.toFixed(2)}%` : '0.00%'}
            </span>
          </div>
          <span className="text-[10px] text-slate-500">Uptime: {health?.uptime || 'N/A'}</span>
        </div>

        {/* Replicas & Alerts */}
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <Layers className="w-3.5 h-3.5 text-violet-400" /> Replicas
            </div>
            <span className="font-mono font-bold text-sm text-slate-100">{service.replicas} active</span>
          </div>
          {(health?.activeAlerts || 0) > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
              <AlertCircle className="w-3 h-3" />
              {health?.activeAlerts} alert{(health?.activeAlerts || 0) > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Control Actions */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-2">
        <button
          onClick={() => onRestart(service.id)}
          disabled={isRestarting}
          className="flex-1 px-3 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700/80 transition-all cursor-pointer disabled:opacity-50 hover:border-amber-500/40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRestarting ? 'animate-spin text-cyan-400' : 'text-amber-400'}`} />
          Restart Service
        </button>

        <button
          onClick={() => setShowScaleModal(true)}
          className="flex-1 px-3 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700/80 transition-all cursor-pointer hover:border-indigo-500/40"
        >
          <Zap className="w-3.5 h-3.5 text-indigo-400" />
          Scale ({service.replicas})
        </button>
      </div>

      {/* Quick Scale Modal */}
      {showScaleModal && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-sm z-20 p-4 rounded-2xl flex flex-col justify-center animate-fade-in border border-indigo-500/30">
          <h4 className="text-xs font-bold text-white mb-2">Adjust Replicas for {service.name}</h4>
          <p className="text-[11px] text-slate-400 mb-3">
            Allowed limits: {service.minReplicas} to {service.maxReplicas} instances
          </p>

          <div className="flex items-center justify-center gap-3 mb-4">
            <button
              onClick={() => setScaleValue(Math.max(service.minReplicas, scaleValue - 1))}
              className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-white font-bold hover:bg-slate-700 cursor-pointer"
            >
              -
            </button>
            <span className="text-lg font-mono font-bold text-indigo-400 px-4 py-1 bg-slate-900 rounded-lg border border-slate-800">
              {scaleValue}
            </span>
            <button
              onClick={() => setScaleValue(Math.min(service.maxReplicas, scaleValue + 1))}
              className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-white font-bold hover:bg-slate-700 cursor-pointer"
            >
              +
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowScaleModal(false)}
              className="flex-1 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setShowScaleModal(false);
                onScale(service.id, scaleValue);
              }}
              className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer"
            >
              Confirm Scale
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
