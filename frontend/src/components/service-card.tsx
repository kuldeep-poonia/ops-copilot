import React, { useState } from 'react';
import {
  Activity,
  Cpu,
  Database,
  RefreshCw,
  Server,
  Layers,
  AlertCircle,
  Sliders,
} from 'lucide-react';
import type { Service, ServiceHealth } from '../types';

interface ServiceCardProps {
  service: Service;
  health?: ServiceHealth;
  onRestart: (serviceId: string) => void;
  onScale: (serviceId: string, replicas: number) => void;
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
  const isDown = status === 'down' || status === 'unhealthy';

  const statusConfig = {
    healthy: {
      text: 'Healthy',
      color: '#34C759',
      bg: '#EAF9EE',
      border: '#B6E8C2',
      dot: 'bg-[#34C759]',
    },
    degraded: {
      text: 'Needs Attention',
      color: '#FF9F0A',
      bg: '#FFF6E8',
      border: '#FFE1B0',
      dot: 'bg-[#FF9F0A]',
    },
    restarting: {
      text: 'Restarting',
      color: '#0071E3',
      bg: '#EBF4FF',
      border: '#BCD9FF',
      dot: 'bg-[#0071E3] animate-spin',
    },
    down: {
      text: 'Offline',
      color: '#FF3B30',
      bg: '#FFF0EF',
      border: '#FFC7C4',
      dot: 'bg-[#FF3B30]',
    },
    unhealthy: {
      text: 'Critical',
      color: '#FF3B30',
      bg: '#FFF0EF',
      border: '#FFC7C4',
      dot: 'bg-[#FF3B30]',
    },
  };

  const currentStatus = statusConfig[status as keyof typeof statusConfig] || statusConfig.healthy;

  return (
    <div
      className={`rounded-2xl border transition-all p-5 bg-white ${
        isDegraded
          ? 'border-[#FF9F0A] shadow-sm'
          : isDown
          ? 'border-[#FF3B30] shadow-sm'
          : 'border-[#D2D2D7]'
      } relative`}
    >
      {/* Header: Service Name & Status Badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]">
            <Server className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#1D1D1F] leading-tight">{service.name}</h3>
            <span className="text-xs text-[#6E6E73] font-mono">{service.id}</span>
          </div>
        </div>

        {/* Hero Status Badge */}
        <div
          className="px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border shrink-0"
          style={{
            backgroundColor: currentStatus.bg,
            color: currentStatus.color,
            borderColor: currentStatus.border,
          }}
        >
          <span className={`w-2 h-2 rounded-full ${currentStatus.dot}`} />
          <span>{currentStatus.text}</span>
        </div>
      </div>

      <p className="text-xs text-[#6E6E73] mb-4 line-clamp-2">{service.description}</p>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {/* CPU */}
        <div className="bg-[#F5F5F7] p-3 rounded-xl border border-[#E5E5EA]">
          <div className="flex items-center justify-between text-xs text-[#6E6E73] mb-1">
            <span className="flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" /> CPU
            </span>
            <span className="font-medium text-[#1D1D1F]">
              {health?.cpuUsage !== undefined ? `${health.cpuUsage.toFixed(1)}%` : '---'}
            </span>
          </div>
          <div className="w-full bg-[#E5E5EA] h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                (health?.cpuUsage || 0) > 85
                  ? 'bg-[#FF3B30]'
                  : (health?.cpuUsage || 0) > 70
                  ? 'bg-[#FF9F0A]'
                  : 'bg-[#34C759]'
              }`}
              style={{ width: `${Math.min(100, health?.cpuUsage || 0)}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="bg-[#F5F5F7] p-3 rounded-xl border border-[#E5E5EA]">
          <div className="flex items-center justify-between text-xs text-[#6E6E73] mb-1">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5" /> Memory
            </span>
            <span className="font-medium text-[#1D1D1F]">
              {health?.memoryUsage !== undefined ? `${health.memoryUsage.toFixed(1)}%` : '---'}
            </span>
          </div>
          <div className="w-full bg-[#E5E5EA] h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                (health?.memoryUsage || 0) > 85
                  ? 'bg-[#FF3B30]'
                  : (health?.memoryUsage || 0) > 75
                  ? 'bg-[#FF9F0A]'
                  : 'bg-[#34C759]'
              }`}
              style={{ width: `${Math.min(100, health?.memoryUsage || 0)}%` }}
            />
          </div>
        </div>

        {/* Error Rate */}
        <div className="bg-[#F5F5F7] p-3 rounded-xl border border-[#E5E5EA]">
          <div className="flex items-center justify-between text-xs text-[#6E6E73]">
            <span className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5" /> Error Rate
            </span>
            <span
              className={`font-medium ${
                (health?.errorRate || 0) > 2 ? 'text-[#FF3B30] font-bold' : 'text-[#1D1D1F]'
              }`}
            >
              {health?.errorRate !== undefined ? `${health.errorRate.toFixed(2)}%` : '0.00%'}
            </span>
          </div>
          <span className="text-[11px] text-[#6E6E73] mt-1 block">Uptime: {health?.uptime || 'N/A'}</span>
        </div>

        {/* Replicas & Alerts */}
        <div className="bg-[#F5F5F7] p-3 rounded-xl border border-[#E5E5EA] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1 text-xs text-[#6E6E73]">
              <Layers className="w-3.5 h-3.5" /> Replicas
            </div>
            <span className="font-semibold text-xs text-[#1D1D1F]">{service.replicas} active</span>
          </div>
          {(health?.activeAlerts || 0) > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#FF3B30] bg-[#FFF0EF] px-2 py-0.5 rounded-full border border-[#FFC7C4]">
              <AlertCircle className="w-3 h-3" />
              {health?.activeAlerts} alert{(health?.activeAlerts || 0) > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-2 pt-3 border-t border-[#E5E5EA]">
        <button
          type="button"
          onClick={() => onRestart(service.id)}
          disabled={isRestarting}
          className="flex-1 px-3 py-2 rounded-xl bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] text-xs font-medium flex items-center justify-center gap-1.5 border border-[#D2D2D7] transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRestarting ? 'animate-spin text-[#0071E3]' : 'text-[#6E6E73]'}`} />
          Restart
        </button>

        <button
          type="button"
          onClick={() => setShowScaleModal(true)}
          className="flex-1 px-3 py-2 rounded-xl bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] text-xs font-medium flex items-center justify-center gap-1.5 border border-[#D2D2D7] transition-colors cursor-pointer"
        >
          <Sliders className="w-3.5 h-3.5 text-[#6E6E73]" />
          Scale ({service.replicas})
        </button>
      </div>

      {/* Inline Scale Controller */}
      {showScaleModal && (
        <div className="absolute inset-0 bg-white/98 z-10 p-5 rounded-2xl flex flex-col justify-center border border-[#D2D2D7] animate-fade-in">
          <h4 className="text-xs font-bold text-[#1D1D1F] mb-1">Scale {service.name}</h4>
          <p className="text-[11px] text-[#6E6E73] mb-4">
            Range: {service.minReplicas} to {service.maxReplicas} instances
          </p>

          <div className="flex items-center justify-center gap-3 mb-5">
            <button
              type="button"
              onClick={() => setScaleValue(Math.max(service.minReplicas, scaleValue - 1))}
              className="w-8 h-8 rounded-lg bg-[#F5F5F7] border border-[#D2D2D7] text-[#1D1D1F] font-bold hover:bg-[#E5E5EA] cursor-pointer"
            >
              -
            </button>
            <span className="text-base font-semibold text-[#1D1D1F] px-4 py-1 bg-[#F5F5F7] rounded-lg border border-[#D2D2D7] min-w-[50px] text-center">
              {scaleValue}
            </span>
            <button
              type="button"
              onClick={() => setScaleValue(Math.min(service.maxReplicas, scaleValue + 1))}
              className="w-8 h-8 rounded-lg bg-[#F5F5F7] border border-[#D2D2D7] text-[#1D1D1F] font-bold hover:bg-[#E5E5EA] cursor-pointer"
            >
              +
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowScaleModal(false)}
              className="flex-1 py-2 rounded-xl border border-[#D2D2D7] text-xs font-medium text-[#1D1D1F] bg-[#F5F5F7] hover:bg-[#E5E5EA] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowScaleModal(false);
                onScale(service.id, scaleValue);
              }}
              className="flex-1 py-2 rounded-xl bg-[#1D1D1F] hover:bg-[#3A3A3C] text-xs font-semibold text-white cursor-pointer"
            >
              Apply Scale
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
