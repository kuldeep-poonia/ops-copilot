import React from 'react';
import { Shield, CheckCircle2, XCircle, AlertCircle, Clock, Bot, User } from 'lucide-react';
import type { AuditEntry } from '../types';

interface AuditPanelProps {
  entries: AuditEntry[];
  total: number;
  onRefresh: () => void;
}

export const AuditPanel: React.FC<AuditPanelProps> = ({ entries, total, onRefresh }) => {
  const resultBadges: Record<string, { text: string; bg: string; color: string; border: string }> = {
    success: { text: 'Executed', bg: '#EAF9EE', color: '#34C759', border: '#B6E8C2' },
    failed: { text: 'Failed', bg: '#FFF0EF', color: '#FF3B30', border: '#FFC7C4' },
    rejected: { text: 'Rejected', bg: '#FFF0EF', color: '#FF3B30', border: '#FFC7C4' },
    confirmation_required: { text: 'Pending Human Review', bg: '#FFF6E8', color: '#FF9F0A', border: '#FFE1B0' },
  };

  return (
    <div className="bg-white border border-[#D2D2D7] rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-[#D2D2D7]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#1D1D1F]">Audit Log</h3>
            <p className="text-xs text-[#6E6E73]">
              {total} immutable action records across agents and human operators
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] border border-[#D2D2D7] transition-colors cursor-pointer"
        >
          Refresh Log
        </button>
      </div>

      {/* Entries Timeline */}
      {entries.length === 0 ? (
        <div className="text-center py-12 text-[#6E6E73]">
          <p className="text-sm">No actions recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const isSuccess = entry.resultStatus === 'success';
            const isFailed = entry.resultStatus === 'failed';
            const isRejected = entry.resultStatus === 'rejected';
            const isPending = entry.resultStatus === 'confirmation_required';
            const isAgent = entry.actor === 'agent';

            const badge = resultBadges[entry.resultStatus] || resultBadges.success;

            return (
              <div
                key={entry.id}
                className="bg-[#F5F5F7] p-3 rounded-xl border border-[#E5E5EA] text-xs transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    {/* Actor Identification Badge */}
                    {isAgent ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EBF4FF] text-[#0071E3] border border-[#BCD9FF] flex items-center gap-1">
                        <Bot className="w-3 h-3" /> Agent
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white text-[#1D1D1F] border border-[#D2D2D7] flex items-center gap-1">
                        <User className="w-3 h-3 text-[#6E6E73]" /> Human
                      </span>
                    )}

                    <span className="font-semibold text-[#1D1D1F]">
                      {entry.actionType.replace('_', ' ')}
                    </span>

                    <span className="text-[#6E6E73]">on</span>
                    <span className="font-medium text-[#1D1D1F]">{entry.serviceName}</span>
                  </div>

                  {/* Status Outcome Badge */}
                  <span
                    className="px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 border"
                    style={{
                      backgroundColor: badge.bg,
                      color: badge.color,
                      borderColor: badge.border,
                    }}
                  >
                    {isSuccess && <CheckCircle2 className="w-3 h-3 text-[#34C759]" />}
                    {isFailed && <XCircle className="w-3 h-3 text-[#FF3B30]" />}
                    {isRejected && <AlertCircle className="w-3 h-3 text-[#FF3B30]" />}
                    {isPending && <Clock className="w-3 h-3 text-[#FF9F0A]" />}
                    {badge.text}
                  </span>
                </div>

                {/* Parameters & Timestamp */}
                <div className="flex items-center justify-between text-[#6E6E73] text-[11px] mt-1 font-mono">
                  <span className="truncate max-w-md bg-white px-2 py-0.5 rounded border border-[#E5E5EA] text-[#1D1D1F]">
                    {entry.parameters}
                  </span>
                  <span className="shrink-0 ml-2">
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </span>
                </div>

                {entry.errorMessage && (
                  <div className="mt-1.5 text-[#FF3B30] bg-[#FFF0EF] p-2 rounded-lg text-[11px] border border-[#FFC7C4]">
                    Error: {entry.errorMessage}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
