import React, { useState } from 'react';
import { Plus, X, Globe, ChevronDown, ChevronUp, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
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
  const [urlInput, setUrlInput] = useState('');
  const [customName, setCustomName] = useState('');
  const [customId, setCustomId] = useState('');
  const [customControlUrl, setCustomControlUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [replicas, setReplicas] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Auto-detect service properties from URL
  const autoDetectService = (rawUrl: string) => {
    let clean = rawUrl.trim();
    if (!clean) return { name: '', id: '', metricsUrl: '', controlUrl: '' };
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }
    clean = clean.replace(/\/+$/, '');

    // Special case for Social MCP or Render hosted services
    if (clean.includes('social-mcp') || clean.includes('social-publish-mcp')) {
      return {
        name: 'Social Publishing MCP Server',
        id: 'social-mcp',
        metricsUrl: clean.endsWith('/metrics') ? clean : `${clean}/metrics`,
        controlUrl: 'https://api.render.com/v1/services/srv-da76eg0ae00c73ar5vr0',
        rawUrl: clean,
      };
    }

    try {
      const parsed = new URL(clean);
      const host = parsed.hostname;

      // Detect Render dashboard/api URL
      const srvMatch = clean.match(/srv-[a-z0-9]+/i);
      const renderControlUrl = srvMatch ? `https://api.render.com/v1/services/${srvMatch[0]}` : `${clean}/control`;

      const sub = host.split('.')[0] || 'service';
      const formattedName = sub
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ') + (sub.includes('mcp') ? '' : ' Service');

      const id = srvMatch ? srvMatch[0] : sub.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 32);
      const metricsUrl = clean.endsWith('/metrics') ? clean : `${clean}/metrics`;

      return { name: formattedName, id, metricsUrl, controlUrl: renderControlUrl, rawUrl: clean };
    } catch {
      return { name: clean, id: 'custom-svc', metricsUrl: clean, controlUrl: `${clean}/control`, rawUrl: clean };
    }
  };

  const detected = autoDetectService(urlInput);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) {
      setErrorMsg('Please enter or paste a valid service URL.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const targetUrl = detected.rawUrl;
    const finalName = customName.trim() || detected.name || 'Monitored Service';
    const finalId = customId.trim() || detected.id || 'service-' + Date.now().toString().slice(-4);
    const finalMetricsUrl = detected.metricsUrl;
    const finalControlUrl = customControlUrl.trim() || detected.controlUrl;

    try {
      const resp = await api.registerService({
        id: finalId,
        name: finalName,
        description: `Live microservice auto-connected from ${targetUrl}`,
        endpointUrl: finalMetricsUrl,
        controlApiUrl: finalControlUrl,
        controlApiKey: customApiKey.trim(),
        currentStatus: 'healthy',
        replicas: replicas || 1,
        minReplicas: 1,
        maxReplicas: 10,
      });

      onSuccess(resp.service);
      onClose();
      setUrlInput('');
      setCustomName('');
      setCustomId('');
      setCustomControlUrl('');
      setCustomApiKey('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect service';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-[#D2D2D7] shadow-2xl overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E5E5EA] flex items-center justify-between bg-[#F5F5F7]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#EBF4FF] border border-[#BCD9FF] flex items-center justify-center text-[#0071E3]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1D1D1F]">Connect New Service via URL</h3>
              <p className="text-[11px] text-[#6E6E73]">Paste URL to start instant real-time telemetry monitoring</p>
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-[#FFF2F2] border border-[#FFD2D2] text-[#FF3B30] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Single URL Input */}
          <div>
            <label className="block font-semibold text-[#1D1D1F] mb-1.5 text-xs">
              Service or MCP Server URL
            </label>
            <div className="relative">
              <input
                type="text"
                autoFocus
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://social-mcp.duckdns.org or https://api.yoursite.com"
                required
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#D2D2D7] bg-white text-[#1D1D1F] text-xs font-mono placeholder:font-sans focus:outline-none focus:border-[#0071E3] focus:ring-2 focus:ring-[#0071E3]/20"
              />
              <Globe className="w-4 h-4 text-[#86868B] absolute left-3 top-3" />
            </div>
            <p className="text-[11px] text-[#86868B] mt-1.5">
              Supports any HTTP API, Prometheus metrics, Node.js/Go/Python service, or Render deployment.
            </p>
          </div>

          {/* Live Auto-Detection Pill */}
          {urlInput.trim().length > 3 && (
            <div className="p-3.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2 animate-fade-in">
              <div className="flex items-center gap-1.5 text-[#34C759] font-medium text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Auto-Configured Ready to Stream</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-white p-2 rounded-lg border border-[#E5E5EA]">
                  <span className="text-[#86868B] block text-[10px]">Detected Name</span>
                  <span className="font-semibold text-[#1D1D1F] truncate block">
                    {customName || detected.name}
                  </span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-[#E5E5EA]">
                  <span className="text-[#86868B] block text-[10px]">Service ID</span>
                  <span className="font-mono text-[#1D1D1F] truncate block">
                    {customId || detected.id}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Advanced Settings */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-[#0071E3] hover:underline flex items-center gap-1 cursor-pointer font-medium"
            >
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showAdvanced ? 'Hide Advanced Configuration' : 'Customize Name, API Key or Replicas (Optional)'}
            </button>

            {showAdvanced && (
              <div className="mt-3 p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3 animate-fade-in">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#1D1D1F] mb-1">Custom Display Name</label>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder={detected.name || 'e.g. Social Publishing API'}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#D2D2D7] bg-white text-[#1D1D1F] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#1D1D1F] mb-1">Custom Service ID</label>
                    <input
                      type="text"
                      value={customId}
                      onChange={(e) => setCustomId(e.target.value)}
                      placeholder={detected.id || 'e.g. social-mcp'}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#D2D2D7] bg-white text-[#1D1D1F] text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#1D1D1F] mb-1">Control API Key / Bearer</label>
                    <input
                      type="password"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      placeholder="Optional API Secret"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#D2D2D7] bg-white text-[#1D1D1F] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#1D1D1F] mb-1">Initial Replicas</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={replicas}
                      onChange={(e) => setReplicas(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#D2D2D7] bg-white text-[#1D1D1F] text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
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
              disabled={isSubmitting || !urlInput.trim()}
              className="px-5 py-2 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {isSubmitting ? 'Connecting...' : 'Connect & Monitor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
