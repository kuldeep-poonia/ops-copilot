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
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Active Incidents & Alerts</h3>
            <p className="text-xs text-slate-400">
              {alerts.filter((a) => a.status === 'firing').length} firing, {alerts.filter((a) => a.status === 'acknowledged').length} acknowledged
            </p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          {(['all', 'firing', 'acknowledged', 'resolved'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all capitalize cursor-pointer ${
                filter === tab ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-emerald-500/50" />
          <p className="text-sm">No alerts matching filter.</p>
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
                    ? 'bg-rose-950/20 border-rose-500/30'
                    : isAck
                    ? 'bg-amber-950/20 border-amber-500/30'
                    : 'bg-slate-950/40 border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          alert.severity === 'critical'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {alert.severity}
                      </span>
                      <span className="text-xs font-semibold text-slate-300">{alert.serviceName}</span>
                      <span className="text-xs text-slate-500 font-mono">({alert.id})</span>
                    </div>

                    <h4 className="text-sm font-bold text-white mb-1">{alert.title}</h4>
                    <p className="text-xs text-slate-400 mb-2">{alert.message}</p>

                    <div className="flex items-center gap-4 text-[11px] text-slate-400">
                      <span>
                        Metric: <span className="font-mono text-slate-300">{alert.metricName}</span>
                      </span>
                      <span>
                        Observed: <span className="font-mono text-slate-200">{alert.observedValue}</span> (Threshold: {alert.thresholdValue})
                      </span>
                      {alert.acknowledgedBy && (
                        <span className="text-indigo-400 font-medium">Ack by: {alert.acknowledgedBy}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isFiring && (
                      <button
                        onClick={() => setActiveAckAlertId(activeAckAlertId === alert.id ? null : alert.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Acknowledge
                      </button>
                    )}

                    <button
                      onClick={() => setActiveNoteAlertId(activeNoteAlertId === alert.id ? null : alert.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1 border border-slate-700 transition-colors cursor-pointer"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5 text-indigo-400" />
                      Add Note
                    </button>

                    <button
                      onClick={() => setExpandedAlertId(isExpanded ? null : alert.id)}
                      className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Inline Acknowledge Form */}
                {activeAckAlertId === alert.id && (
                  <div className="mt-3 pt-3 border-t border-slate-800 flex gap-2 animate-fade-in">
                    <input
                      type="text"
                      placeholder="Optional triage reason / hypothesis..."
                      value={ackReason}
                      onChange={(e) => setAckReason(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      onClick={() => handleSendAck(alert.id)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Confirm Ack
                    </button>
                  </div>
                )}

                {/* Inline Add Note Form */}
                {activeNoteAlertId === alert.id && (
                  <div className="mt-3 pt-3 border-t border-slate-800 flex gap-2 animate-fade-in">
                    <input
                      type="text"
                      placeholder="Add diagnostic note or remediation context..."
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => handleSendNote(alert.id)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Post Note
                    </button>
                  </div>
                )}

                {/* Incident Notes Thread */}
                {isExpanded && alert.notes && alert.notes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2 animate-fade-in">
                    <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Incident Triage Notes</h5>
                    <div className="space-y-1.5">
                      {alert.notes.map((note) => (
                        <div key={note.id} className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/60 text-xs">
                          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span className="font-semibold text-indigo-300">👤 {note.author}</span>
                            <span>{new Date(note.createdAt).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-slate-200">{note.content}</p>
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
