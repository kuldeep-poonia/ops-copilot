import React, { useState } from 'react';
import { Plus, X, Server, Activity, ShieldCheck, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import type { Service } from '../types';

interface RegisterServiceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newService: Service) => void;
}

export const RegisterServiceDialog: React.FC<RegisterServiceDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [description, setDescription] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [controlApiUrl, setControlApiUrl] = useState('');
  const [controlApiKey, setControlApiKey] = useState('');
  const [minReplicas, setMinReplicas] = useState(1);
  const [maxReplicas, setMaxReplicas] = useState(5);
  const [replicas, setReplicas] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !endpointUrl.trim()) {
      setErrorMsg('Service Name and Endpoint Metrics URL are required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const cleanId = serviceId.trim() || name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 32);

    try {
      const resp = await api.registerService({
        id: cleanId,
        name: name.trim(),
        description: description.trim() || `Monitored microservice at ${endpointUrl.trim()}`,
        endpointUrl: endpointUrl.trim(),
        controlApiUrl: controlApiUrl.trim() || `${endpointUrl.trim()}/control`,
        controlApiKey: controlApiKey.trim(),
        currentStatus: 'healthy',
        replicas,
        minReplicas,
        maxReplicas,
      });

      onSuccess(resp.service);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to register service';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-[#D2D2D7] shadow-2xl overflow-hidden animate-scale-up">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#E5E5EA] flex items-center justify-between bg-[#F5F5F7]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#EBF4FF] border border-[#BCD9FF] flex items-center justify-center text-[#0071E3]">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1D1D1F]">Register New Infrastructure Service</h3>
              <p className="text-[11px] text-[#6E6E73]">Add any live service or MCP server into Ops Co-pilot</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#86868B] hover:text-[#1D1D1F] hover:bg-[#E5E5EA] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-[#FFF2F2] border border-[#FFD2D2] text-[#FF3B30] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-[#1D1D1F] mb-1">
                Service Name <span className="text-[#FF3B30]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!serviceId) {
                    setServiceId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 32));
                  }
                }}
                placeholder="e.g. Payments Gateway"
                required
                className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]"
              />
            </div>

            <div>
              <label className="block font-medium text-[#1D1D1F] mb-1">
                Service ID (Unique Key)
              </label>
              <input
                type="text"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                placeholder="e.g. srv-payments-01"
                className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-[#1D1D1F] mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Core transaction processing microservice"
              className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]"
            />
          </div>

          <div>
            <label className="block font-medium text-[#1D1D1F] mb-1">
              Metrics Endpoint URL <span className="text-[#FF3B30]">*</span>
            </label>
            <div className="relative">
              <input
                type="url"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                placeholder="https://api.yourdomain.com/metrics"
                required
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]"
              />
              <Activity className="w-4 h-4 text-[#86868B] absolute left-2.5 top-2.5" />
            </div>
            <p className="text-[10px] text-[#86868B] mt-1">Accepts Prometheus, OpenTelemetry, or JSON health metric payloads.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-[#1D1D1F] mb-1">
                Control API URL (Restart/Scale)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={controlApiUrl}
                  onChange={(e) => setControlApiUrl(e.target.value)}
                  placeholder="https://api.render.com/v1/services/srv-..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]"
                />
                <Server className="w-4 h-4 text-[#86868B] absolute left-2.5 top-2.5" />
              </div>
            </div>

            <div>
              <label className="block font-medium text-[#1D1D1F] mb-1">
                Control API Key / Bearer
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={controlApiKey}
                  onChange={(e) => setControlApiKey(e.target.value)}
                  placeholder="API Token (if required)"
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]"
                />
                <ShieldCheck className="w-4 h-4 text-[#86868B] absolute left-2.5 top-2.5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-[#1D1D1F] mb-1">Replicas</label>
              <input
                type="number"
                min={1}
                max={50}
                value={replicas}
                onChange={(e) => setReplicas(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F]"
              />
            </div>
            <div>
              <label className="block font-medium text-[#1D1D1F] mb-1">Min Replicas</label>
              <input
                type="number"
                min={1}
                max={50}
                value={minReplicas}
                onChange={(e) => setMinReplicas(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F]"
              />
            </div>
            <div>
              <label className="block font-medium text-[#1D1D1F] mb-1">Max Replicas</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxReplicas}
                onChange={(e) => setMaxReplicas(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F]"
              />
            </div>
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-[#E5E5EA] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#D2D2D7] text-[#1D1D1F] font-medium hover:bg-[#F5F5F7] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {isSubmitting ? 'Registering...' : 'Register Service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
