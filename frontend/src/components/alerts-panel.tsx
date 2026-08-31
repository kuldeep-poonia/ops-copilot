import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  MessageSquarePlus,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Alert } from '../types';

interface AlertsPanelProps {
  alerts: Alert[];
  onAcknowledge: (alertId: string, reason?: string) => Promise<void>;
  onAddNote: (alertId: string, content: string) => Promise<void>;
}

export const AlertsPanel: React.FC<AlertsPanelProps> = ({ alerts, onAcknowledge, onAddNote }) => {
  const [filter, setFilter] = useState<'all' | 'firing' | 'acknowledged' | 'resolved'>('all');
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [activeNoteAlertId, setActiveNoteAlertId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<string>('');
  const [ackReason, setAckReason] = useState<string>('');
  const [activeAckAlertId, setActiveAckAlertId] = useState<string | null>(null);

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'all') return true;
    return a.status === filter;
  });

  const firingCount = alerts.filter((a) => a.status === 'firing').length;

  const handleSendNote = async (alertId: string) => {
    if (!noteContent.trim()) return;
    await onAddNote(alertId, noteContent);
    setNoteContent('');
    setActiveNoteAlertId(null);
  };

  const handleSendAck = async (alertId: string) => {
    await onAcknowledge(alertId, ackReason);
    setAckReason('');
    setActiveAckAlertId(null);
  };

  return (
    <div className="bg-white border border-[#D2D2D7] rounded-2xl p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#D2D2D7] mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-[#1D1D1F]">Active Alerts & Incidents</h3>
            {firingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FFF0EF] text-[#FF3B30] border border-[#FFC7C4]">
                {firingCount} Firing
              </span>
            )}
          </div>
          <p className="text-xs text-[#6E6E73]">Automated threshold detections across infrastructure</p>
        </div>

        {/* Filter Switcher */}
        <div className="flex items-center gap-1 bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs">
          {(['all', 'firing', 'acknowledged', 'resolved'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1 rounded-lg font-medium transition-colors capitalize cursor-pointer ${
                filter === tab
                  ? 'bg-white text-[#1D1D1F] font-semibold shadow-xs border border-[#D2D2D7]'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="text-center py-12 text-[#6E6E73]">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-[#34C759]" />
          <p className="text-sm font-medium text-[#1D1D1F]">All clear</p>
          <p className="text-xs">No alerts matching the selected filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAlerts.map((alert) => {
            const isFiring = alert.status === 'firing';
            const isAck = alert.status === 'acknowledged';
            const isExpanded = expandedAlertId === alert.id;

            return (
              <div
                key={alert.id}
                className={`p-4 rounded-xl border transition-all ${
                  isFiring
                    ? 'bg-[#FFF9F5] border-[#FF9F0A]'
                    : isAck
                    ? 'bg-[#FBFBFC] border-[#E5E5EA]'
                    : 'bg-[#F5F5F7] border-[#E5E5EA] opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${
                          alert.severity === 'critical'
                            ? 'bg-[#FFF0EF] text-[#FF3B30] border border-[#FFC7C4]'
                            : 'bg-[#FFF6E8] text-[#FF9F0A] border border-[#FFE1B0]'
                        }`}
                      >
                        {alert.severity}
                      </span>
                      <span className="text-xs font-semibold text-[#1D1D1F]">{alert.serviceName}</span>
                      <span className="text-xs text-[#6E6E73] font-mono">({alert.id})</span>
                    </div>

                    <h4 className="text-sm font-semibold text-[#1D1D1F] mb-1">{alert.title}</h4>
                    <p className="text-xs text-[#6E6E73] mb-2">{alert.message}</p>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#6E6E73]">
                      <span>
                        Metric: <strong className="text-[#1D1D1F]">{alert.metricName}</strong>
                      </span>
                      <span>
                        Observed: <strong className="text-[#1D1D1F]">{alert.observedValue}</strong> (Threshold: {alert.thresholdValue})
                      </span>
                      {alert.acknowledgedBy && (
                        <span className="text-[#0071E3] font-medium">Ack by: {alert.acknowledgedBy}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isFiring && (
                      <button
                        type="button"
                        onClick={() => setActiveAckAlertId(activeAckAlertId === alert.id ? null : alert.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#FFF6E8] hover:bg-[#FFE1B0] text-[#FF9F0A] text-xs font-medium flex items-center gap-1 border border-[#FFE1B0] cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Acknowledge
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setActiveNoteAlertId(activeNoteAlertId === alert.id ? null : alert.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-[#F5F5F7] text-[#1D1D1F] text-xs font-medium flex items-center gap-1 border border-[#D2D2D7] cursor-pointer"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5 text-[#0071E3]" />
                      Note
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedAlertId(isExpanded ? null : alert.id)}
                      className="p-1.5 rounded-lg bg-white hover:bg-[#F5F5F7] text-[#6E6E73] border border-[#D2D2D7] cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Inline Acknowledge Form */}
                {activeAckAlertId === alert.id && (
                  <div className="mt-3 pt-3 border-t border-[#E5E5EA] flex gap-2 animate-fade-in">
                    <input
                      type="text"
                      placeholder="Optional triage reason / hypothesis..."
                      value={ackReason}
                      onChange={(e) => setAckReason(e.target.value)}
                      className="flex-1 bg-white border border-[#D2D2D7] rounded-lg px-3 py-1.5 text-xs text-[#1D1D1F] placeholder-[#6E6E73] focus:outline-none focus:border-[#FF9F0A]"
                    />
                    <button
                      type="button"
                      onClick={() => handleSendAck(alert.id)}
                      className="px-3 py-1.5 bg-[#FF9F0A] hover:bg-[#E58F09] text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Confirm Ack
                    </button>
                  </div>
                )}

                {/* Inline Add Note Form */}
                {activeNoteAlertId === alert.id && (
                  <div className="mt-3 pt-3 border-t border-[#E5E5EA] flex gap-2 animate-fade-in">
                    <input
                      type="text"
                      placeholder="Add diagnostic note or remediation context..."
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      className="flex-1 bg-white border border-[#D2D2D7] rounded-lg px-3 py-1.5 text-xs text-[#1D1D1F] placeholder-[#6E6E73] focus:outline-none focus:border-[#0071E3]"
                    />
                    <button
                      type="button"
                      onClick={() => handleSendNote(alert.id)}
                      className="px-3 py-1.5 bg-[#0071E3] hover:bg-[#005BB5] text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Save Note
                    </button>
                  </div>
                )}

                {/* Incident Notes Thread */}
                {isExpanded && alert.notes && alert.notes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#E5E5EA] space-y-2 animate-fade-in">
                    <h5 className="text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wider">
                      Incident Notes
                    </h5>
                    <div className="space-y-1.5">
                      {alert.notes.map((note) => (
                        <div key={note.id} className="bg-white p-2.5 rounded-lg border border-[#E5E5EA] text-xs">
                          <div className="flex justify-between text-[10px] text-[#6E6E73] mb-1">
                            <span className="font-semibold text-[#1D1D1F]">{note.author}</span>
                            <span>{new Date(note.createdAt).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-[#1D1D1F]">{note.content}</p>
                        </div>
                      ))}
                    </div>
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
