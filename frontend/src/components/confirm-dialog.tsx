import React, { useEffect, useState } from 'react';
import { AlertCircle, Clock, ShieldAlert, Bot } from 'lucide-react';
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

  const actionName = challenge.actionType.replace('_', ' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
      <div
        className="bg-white border border-[#D2D2D7] rounded-2xl shadow-xl max-w-lg w-full p-6 text-[#1D1D1F] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        {/* Header */}
        <div className="flex items-start gap-3.5 pb-4 border-b border-[#D2D2D7]">
          <div className="p-2.5 bg-[#FFF2E5] rounded-xl text-[#FF9F0A] shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#FF9F0A]">Human Confirmation Required</span>
              <span className="flex items-center gap-1 text-xs text-[#6E6E73]">
                <Clock className="w-3.5 h-3.5" /> {timeLeft}s remaining
              </span>
            </div>
            <h2 id="confirm-dialog-title" className="text-lg font-bold text-[#1D1D1F] mt-0.5">
              Confirm {actionName.charAt(0).toUpperCase() + actionName.slice(1)}
            </h2>
          </div>
        </div>

        {/* Action Details */}
        <div className="py-4 space-y-3.5 text-sm">
          {/* Target Service Card */}
          <div className="bg-[#F5F5F7] rounded-xl p-3.5 border border-[#E5E5EA]">
            <div className="flex justify-between items-center text-xs mb-1.5">
              <span className="text-[#6E6E73]">Target Service</span>
              <span className="font-semibold text-[#1D1D1F]">{challenge.serviceName}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6E6E73]">Identifier</span>
              <span className="font-mono text-xs text-[#1D1D1F]">{challenge.serviceId}</span>
            </div>
          </div>

          {/* Stated Rationale */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73] mb-1.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#EBF4FF] text-[#0071E3] font-semibold text-[11px]">
                <Bot className="w-3 h-3" /> Agent Proposal
              </span>
              <span>Stated Reason</span>
            </div>
            <div className="bg-[#F5F5F7] rounded-xl p-3 text-xs text-[#1D1D1F] border border-[#E5E5EA] italic">
              "{challenge.reason || 'No additional rationale provided.'}"
            </div>
          </div>

          {/* Verified Parameters */}
          {Object.keys(parsedParams).length > 0 && (
            <div>
              <span className="block text-xs font-medium text-[#6E6E73] mb-1.5">Verified Parameters</span>
              <pre className="bg-[#F5F5F7] p-2.5 rounded-xl text-xs font-mono text-[#1D1D1F] border border-[#E5E5EA] overflow-x-auto">
                {JSON.stringify(parsedParams, null, 2)}
              </pre>
            </div>
          )}

          {/* What happens if declined */}
          <div className="p-3 bg-[#F5F5F7] rounded-xl border border-[#E5E5EA] text-xs text-[#6E6E73]">
            <span className="font-semibold text-[#1D1D1F]">If you decline: </span>
            No changes will be applied. {challenge.serviceName} will continue operating normally.
          </div>

          {errorMsg && (
            <div className="p-3 bg-[#FFF0EF] border border-[#FF3B30]/30 rounded-xl text-[#FF3B30] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-[#E5E5EA] h-1 rounded-full overflow-hidden mb-4">
          <div
            className="bg-[#FF9F0A] h-full transition-all duration-1000 ease-linear"
            style={{ width: `${(timeLeft / 60) * 100}%` }}
          />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#D2D2D7]">
          <button
            type="button"
            onClick={handleReject}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#1D1D1F] bg-[#F5F5F7] hover:bg-[#E5E5EA] border border-[#D2D2D7] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel Action
          </button>

          <button
            type="button"
            onClick={handleApprove}
            disabled={isSubmitting || timeLeft <= 0}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#1D1D1F] hover:bg-[#3A3A3C] transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'Authorizing...' : 'Approve & Execute'}
          </button>
        </div>
      </div>
    </div>
  );
};
