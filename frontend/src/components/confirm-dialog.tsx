import React, { useEffect, useState } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';
import type { ConfirmationChallenge } from '../types';
import { api } from '../services/api';

interface ConfirmDialogProps {
  challenge: ConfirmationChallenge;
  onApprove: (token: string) => void;
  onReject: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ challenge, onApprove, onReject }) => {
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Parse parameters safely for display
  let parsedParams: Record<string, unknown> = {};
  try {
    parsedParams = JSON.parse(challenge.parameters);
  } catch {
    parsedParams = { raw: challenge.parameters };
  }

  useEffect(() => {
    const expiresAt = new Date(challenge.expiresAt).getTime();
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onReject();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [challenge.expiresAt, onReject]);

  const handleApprove = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await api.reviewChallenge(challenge.challengeId, true, 'human-operator');
      if (resp.approved && resp.confirmationToken) {
        onApprove(resp.confirmationToken);
      } else {
        setErrorMsg(resp.message || 'Approval was rejected by server');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to approve action';
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    try {
      await api.reviewChallenge(challenge.challengeId, false, 'human-operator');
    } catch {
      // Best effort reject
    } finally {
      setIsSubmitting(false);
      onReject();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border-2 border-amber-500/50 rounded-2xl shadow-2xl shadow-amber-500/10 max-w-xl w-full p-6 text-slate-100 overflow-hidden relative">
        {/* Animated Warning Header */}
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4 mb-4">
          <div className="p-3 bg-amber-500/20 rounded-xl border border-amber-500/40 text-amber-400">
            <ShieldAlert className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                High-Risk Guardrail
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5" /> {timeLeft}s remaining
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">Human Confirmation Required</h2>
          </div>
        </div>

        {/* Action Details Grid */}
        <div className="space-y-4 text-sm">
          <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800 space-y-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Target Service:</span>
              <span className="font-semibold text-white px-2 py-0.5 rounded bg-slate-800">
                {challenge.serviceName} ({challenge.serviceId})
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Proposed Action:</span>
              <span className="font-mono font-bold text-amber-300 uppercase px-2 py-0.5 rounded bg-amber-950/40 border border-amber-700/50">
                {challenge.actionType.replace('_', ' ')}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Requested By:</span>
              <span className="font-medium text-indigo-400 capitalize flex items-center gap-1">
                🤖 {challenge.initiator}
              </span>
            </div>
          </div>

          {/* Stated Reason */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Agent Technical Rationale</label>
            <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/80 text-slate-200 text-xs italic">
              "{challenge.reason || 'No additional rationale provided.'}"
            </div>
          </div>

          {/* Real Backend Parameters (Safety by Construction) */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Verified Payload Parameters</label>
            <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs font-mono text-cyan-300 overflow-x-auto">
              {JSON.stringify(parsedParams, null, 2)}
            </pre>
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-lg text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Expiry Progress Bar */}
        <div className="w-full bg-slate-800 h-1 rounded-full my-5 overflow-hidden">
          <div
            className="bg-amber-500 h-full transition-all duration-1000 ease-linear"
            style={{ width: `${(timeLeft / 60) * 100}%` }}
          />
        </div>

        {/* Confirmation Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={handleReject}
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <XCircle className="w-4 h-4 text-rose-400" />
            Reject Action
          </button>

          <button
            onClick={handleApprove}
            disabled={isSubmitting || timeLeft <= 0}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50"
          >
            <CheckCircle className="w-4 h-4" />
            {isSubmitting ? 'Authorizing...' : 'Approve & Execute'}
          </button>
        </div>
      </div>
    </div>
  );
};
