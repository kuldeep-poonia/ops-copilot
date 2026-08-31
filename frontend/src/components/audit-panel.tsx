import { Shield, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react';
import type { AuditEntry } from '../types';

interface AuditPanelProps {
  entries: AuditEntry[];
  total: number;
  onRefresh: () => void;
}

export const AuditPanel: React.FC<AuditPanelProps> = ({ entries, total, onRefresh }) => {
  const resultBadges = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    failed: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    rejected: 'bg-rose-950/40 text-rose-300 border-rose-800/50',
    confirmation_required: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Immutable Audit Trail</h3>
            <p className="text-xs text-slate-400">
              {total} operational action attempts recorded across agents & humans
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
        >
          Refresh Log
        </button>
      </div>

      {/* Audit Entries Stream */}
      {entries.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
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

            return (
              <div
                key={entry.id}
                className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 hover:border-slate-700/60 transition-colors text-xs"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                        isAgent
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}
                    >
                      {isAgent ? '🤖 Agent' : '👤 Human'}
                    </span>

                    <span className="font-mono font-bold text-slate-200">
                      {entry.actionType}
                    </span>

                    <span className="text-slate-500">on</span>
                    <span className="font-semibold text-slate-300">{entry.serviceName}</span>
                  </div>

                  {/* Result Badge */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
                      resultBadges[entry.resultStatus] || resultBadges.success
                    }`}
                  >
                    {isSuccess && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                    {isFailed && <XCircle className="w-3 h-3 text-rose-400" />}
                    {isRejected && <AlertCircle className="w-3 h-3 text-rose-300" />}
                    {isPending && <Clock className="w-3 h-3 text-amber-400" />}
                    {entry.resultStatus.replace('_', ' ')}
                  </span>
                </div>

                {/* Parameters & Error Details */}
                <div className="flex items-center justify-between text-slate-400 text-[11px] mt-1 font-mono">
                  <span className="truncate max-w-md bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    params: {entry.parameters}
                  </span>
                  <span className="text-slate-500 shrink-0 ml-2">
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </span>
                </div>

                {entry.errorMessage && (
                  <div className="mt-1.5 text-rose-400 bg-rose-950/30 p-1.5 rounded text-[11px] border border-rose-900/40">
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
