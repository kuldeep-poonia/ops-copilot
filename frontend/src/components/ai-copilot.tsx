import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, RefreshCw, Terminal } from 'lucide-react';
import { createWebMCPTools } from '../webmcp/registry';
import type { WebMCPTool } from '../types';

interface Message {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  toolUsed?: string;
  toolResult?: unknown;
  timestamp: string;
}

interface AICopilotProps {
  onActionTriggered?: () => void;
}

export const AICopilot: React.FC<AICopilotProps> = ({ onActionTriggered }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-1',
      sender: 'agent',
      text: "Hello! I am your autonomous Ops Co-pilot agent. I have discovered 7 registered WebMCP tools directly on document.modelContext. How can I assist you with your infrastructure today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const tools = createWebMCPTools();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const prompt = (textToSend || inputPrompt).trim();
    if (!prompt || isThinking) return;

    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputPrompt('');
    setIsThinking(true);

    // Simulate Agent Reasoning & WebMCP Tool Execution
    setTimeout(async () => {
      const lower = prompt.toLowerCase();
      let toolToCall: WebMCPTool | undefined;
      let toolParams: Record<string, unknown> = {};
      let responseText = '';
      let executionResult: unknown = null;

      if (lower.includes('health') || lower.includes('status') || lower.includes('diagnose')) {
        toolToCall = tools.find((t) => t.name === 'get_service_health');
        toolParams = { serviceId: 'social-mcp' };
      } else if (lower.includes('alert') || lower.includes('incident')) {
        toolToCall = tools.find((t) => t.name === 'list_active_alerts');
        toolParams = {};
      } else if (lower.includes('audit') || lower.includes('log') || lower.includes('history')) {
        toolToCall = tools.find((t) => t.name === 'get_audit_log');
        toolParams = { limit: 5 };
      } else if (lower.includes('restart') || lower.includes('reboot')) {
        toolToCall = tools.find((t) => t.name === 'restart_service');
        toolParams = { serviceId: 'social-mcp', reason: 'Operator requested restart to clear transient state' };
      } else if (lower.includes('scale')) {
        toolToCall = tools.find((t) => t.name === 'scale_service');
        toolParams = { serviceId: 'social-mcp', replicas: 2, reason: 'Operator requested capacity scaling' };
      }

      if (toolToCall) {
        try {
          executionResult = await toolToCall.execute(toolParams);
          if (toolToCall.name === 'get_service_health') {
            const h = executionResult as Record<string, unknown>;
            responseText = `✅ I invoked document.modelContext.tools.get_service_health for Social Publishing MCP Server. The service is currently ${h.status || 'healthy'} with ${h.cpuUsage || 0}% CPU utilization, ${h.memoryUsage || 0}% memory consumption, and 0 active incidents.`;
          } else if (toolToCall.name === 'list_active_alerts') {
            const alerts = (executionResult as unknown[]) || [];
            responseText = alerts.length === 0
              ? '✅ I invoked document.modelContext.tools.list_active_alerts. Currently, there are 0 active firing alerts. All systems are calm and operational.'
              : `⚠️ Found ${alerts.length} active alerts in triage queue.`;
          } else if (toolToCall.name === 'get_audit_log') {
            responseText = '✅ I retrieved recent operational actions from document.modelContext.tools.get_audit_log. All agent and human actions are immutably preserved.';
          } else if (toolToCall.name === 'restart_service' || toolToCall.name === 'scale_service') {
            responseText = `🛡️ High-Risk Guardrail Intercepted: I called document.modelContext.tools.${toolToCall.name}. The backend returned HTTP 428 Precondition Required. Please review and approve the on-screen Confirmation Dialog modal to execute this mutation!`;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Tool execution error';
          responseText = `Tool execution encountered an error: ${msg}`;
        }
      } else {
        responseText = `I analyzed your request against the 7 available WebMCP tools in document.modelContext. You can ask me to check system health, inspect active alerts, review the audit log, or initiate service restarts with human confirmation.`;
      }

      const agentMsg: Message = {
        id: `agt-${Date.now()}`,
        sender: 'agent',
        text: responseText,
        toolUsed: toolToCall?.name,
        toolResult: executionResult,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, agentMsg]);
      setIsThinking(false);
      onActionTriggered?.();
    }, 600);
  };

  return (
    <>
      {/* Floating Copilot Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 px-4 py-3 bg-[#1D1D1F] hover:bg-[#3A3A3C] text-white rounded-full shadow-xl hover:shadow-2xl transition-all cursor-pointer border border-white/20 group"
      >
        <div className="w-6 h-6 rounded-full bg-[#0071E3] flex items-center justify-center text-white text-xs">
          <Bot className="w-3.5 h-3.5" />
        </div>
        <span className="text-xs font-semibold tracking-tight">AI Copilot Agent</span>
        <span className="w-2 h-2 rounded-full bg-[#34C759] animate-pulse" />
      </button>

      {/* Slide-out Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-[#D2D2D7] animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-[#E5E5EA] flex items-center justify-between bg-[#F5F5F7]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#0071E3] flex items-center justify-center text-white">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1D1D1F]">WebMCP AI Copilot</h3>
                  <p className="text-[11px] text-[#6E6E73] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" />
                    Connected to document.modelContext
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#E5E5EA] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Action Chips */}
            <div className="p-3 bg-[#FAFAFC] border-b border-[#E5E5EA] flex items-center gap-1.5 overflow-x-auto text-[11px]">
              <button
                type="button"
                onClick={() => handleSend('Check health of Social Publishing MCP Server')}
                className="px-2.5 py-1 rounded-full bg-white border border-[#D2D2D7] hover:bg-[#E5E5EA] text-[#1D1D1F] shrink-0 transition-colors cursor-pointer"
              >
                📊 Check Health
              </button>
              <button
                type="button"
                onClick={() => handleSend('List active firing alerts')}
                className="px-2.5 py-1 rounded-full bg-white border border-[#D2D2D7] hover:bg-[#E5E5EA] text-[#1D1D1F] shrink-0 transition-colors cursor-pointer"
              >
                ⚠️ List Alerts
              </button>
              <button
                type="button"
                onClick={() => handleSend('Restart Social Publishing Server (Guardrail Test)')}
                className="px-2.5 py-1 rounded-full bg-white border border-[#D2D2D7] hover:bg-[#E5E5EA] text-[#1D1D1F] shrink-0 transition-colors cursor-pointer"
              >
                🔄 Restart (Guardrail)
              </button>
            </div>

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-[#0071E3] text-white rounded-br-xs'
                        : 'bg-[#F5F5F7] text-[#1D1D1F] border border-[#E5E5EA] rounded-bl-xs'
                    }`}
                  >
                    {msg.text}

                    {msg.toolUsed && (
                      <div className="mt-2.5 pt-2 border-t border-black/10 text-[10px] font-mono text-[#0071E3] flex items-center gap-1.5">
                        <Terminal className="w-3 h-3" />
                        <span>Invoked WebMCP: {msg.toolUsed}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-[#86868B] mt-1 px-1">{msg.timestamp}</span>
                </div>
              ))}

              {isThinking && (
                <div className="flex items-center gap-2 p-3 bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA] max-w-[80%] text-xs text-[#6E6E73]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0071E3]" />
                  <span>Inspecting document.modelContext and invoking tool...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="p-3 border-t border-[#E5E5EA] bg-white flex items-center gap-2"
            >
              <input
                type="text"
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                placeholder="Ask AI agent to inspect or operate..."
                className="flex-1 px-3.5 py-2.5 text-xs bg-[#F5F5F7] border border-[#D2D2D7] rounded-xl focus:outline-hidden focus:border-[#0071E3] text-[#1D1D1F]"
              />
              <button
                type="submit"
                disabled={!inputPrompt.trim() || isThinking}
                className="p-2.5 bg-[#1D1D1F] hover:bg-[#3A3A3C] disabled:opacity-40 text-white rounded-xl transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
