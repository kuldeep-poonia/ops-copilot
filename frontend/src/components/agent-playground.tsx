import React, { useState } from 'react';
import { Bot, Play, CheckCircle2, AlertTriangle, Code2 } from 'lucide-react';
import { createWebMCPTools } from '../webmcp/registry';
import type { WebMCPTool } from '../types';

interface AgentPlaygroundProps {
  onActionCompleted: () => void;
}

export const AgentPlayground: React.FC<AgentPlaygroundProps> = ({ onActionCompleted }) => {
  const tools = createWebMCPTools();
  const [selectedToolName, setSelectedToolName] = useState<string>(tools[0].name);
  const [paramsInput, setParamsInput] = useState<string>('{\n  "serviceId": "payment-service"\n}');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [resultOutput, setResultOutput] = useState<string | null>(null);
  const [errorOutput, setErrorOutput] = useState<string | null>(null);

  const selectedTool = tools.find((t) => t.name === selectedToolName) || tools[0];

  const handleToolSelect = (tool: WebMCPTool) => {
    setSelectedToolName(tool.name);
    setErrorOutput(null);
    setResultOutput(null);

    switch (tool.name) {
      case 'get_service_health':
        setParamsInput('{\n  "serviceId": "payment-service"\n}');
        break;
      case 'list_active_alerts':
        setParamsInput('{\n  "serviceId": "auth-service",\n  "status": "firing"\n}');
        break;
      case 'get_audit_log':
        setParamsInput('{\n  "limit": 10\n}');
        break;
      case 'acknowledge_alert':
        setParamsInput('{\n  "alertId": "alt-test",\n  "reason": "Agent investigating CPU anomaly"\n}');
        break;
      case 'add_incident_note':
        setParamsInput('{\n  "alertId": "alt-test",\n  "content": "Investigated heap dump, memory is stable."\n}');
        break;
      case 'restart_service':
        setParamsInput('{\n  "serviceId": "payment-service",\n  "reason": "Clear transient memory leak under peak load"\n}');
        break;
      case 'scale_service':
        setParamsInput('{\n  "serviceId": "inventory-service",\n  "replicas": 5,\n  "reason": "Handling forecasted flash sale load spike"\n}');
        break;
      default:
        setParamsInput('{}');
    }
  };

  const handleExecute = async () => {
    setIsLoading(true);
    setErrorOutput(null);
    setResultOutput(null);

    try {
      let parsedParams: Record<string, unknown> = {};
      if (paramsInput.trim()) {
        parsedParams = JSON.parse(paramsInput);
      }

      const startTime = performance.now();
      const output = await selectedTool.execute(parsedParams);
      const elapsed = Math.round(performance.now() - startTime);

      setResultOutput(JSON.stringify({ _executionTimeMs: elapsed, result: output }, null, 2));
      onActionCompleted();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown tool execution error';
      setErrorOutput(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white border border-[#D2D2D7] rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#D2D2D7] mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#EBF4FF] text-[#0071E3] border border-[#BCD9FF]">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[#1D1D1F]">WebMCP Agent Console</h3>
              <span className="px-2 py-0.5 rounded-full bg-[#EBF4FF] text-[#0071E3] border border-[#BCD9FF] text-[11px] font-semibold">
                7 Tools Registered
              </span>
            </div>
            <p className="text-xs text-[#6E6E73]">
              Execute registered browser WebMCP tools directly as an AI agent
            </p>
          </div>
        </div>
      </div>

      {/* Quick Scenarios Bar */}
      <div className="mb-4 bg-[#F5F5F7] p-3 rounded-xl border border-[#E5E5EA] flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[#1D1D1F]">Test Scenarios:</span>

        <button
          type="button"
          onClick={() => {
            const tool = tools.find((t) => t.name === 'get_service_health')!;
            handleToolSelect(tool);
            setParamsInput('{\n  "serviceId": "auth-service"\n}');
          }}
          className="px-2.5 py-1 bg-white hover:bg-[#E5E5EA] text-[#1D1D1F] text-xs font-medium rounded-lg border border-[#D2D2D7] cursor-pointer"
        >
          Check Auth Health (Read-only)
        </button>

        <button
          type="button"
          onClick={() => {
            const tool = tools.find((t) => t.name === 'restart_service')!;
            handleToolSelect(tool);
            setParamsInput('{\n  "serviceId": "payment-service",\n  "reason": "Clear transient memory leak under peak load"\n}');
          }}
          className="px-2.5 py-1 bg-[#FFF6E8] hover:bg-[#FFE1B0] text-[#FF9F0A] text-xs font-semibold rounded-lg border border-[#FFE1B0] cursor-pointer"
        >
          Restart Payment API (High-Risk Guardrail)
        </button>

        <button
          type="button"
          onClick={() => {
            const tool = tools.find((t) => t.name === 'scale_service')!;
            handleToolSelect(tool);
            setParamsInput('{\n  "serviceId": "inventory-service",\n  "replicas": 6,\n  "reason": "Scale out for warehouse surge"\n}');
          }}
          className="px-2.5 py-1 bg-[#EBF4FF] hover:bg-[#BCD9FF] text-[#0071E3] text-xs font-semibold rounded-lg border border-[#BCD9FF] cursor-pointer"
        >
          Scale Inventory Replicas (High-Risk)
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Available Tools */}
        <div className="space-y-1.5 bg-[#F5F5F7] p-3 rounded-xl border border-[#E5E5EA] max-h-80 overflow-y-auto">
          <span className="block text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-2">
            Available WebMCP Tools
          </span>
          {tools.map((tool) => {
            const isSelected = tool.name === selectedToolName;
            return (
              <button
                key={tool.name}
                type="button"
                onClick={() => handleToolSelect(tool)}
                className={`w-full text-left p-2.5 rounded-lg text-xs transition-colors flex flex-col gap-1 cursor-pointer ${
                  isSelected
                    ? 'bg-white border border-[#0071E3] text-[#1D1D1F] font-semibold shadow-xs'
                    : 'hover:bg-white border border-transparent text-[#6E6E73]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[#0071E3] text-xs">{tool.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      tool.tier === 'high-risk'
                        ? 'bg-[#FFF6E8] text-[#FF9F0A] border border-[#FFE1B0]'
                        : tool.tier === 'low-risk'
                        ? 'bg-[#EBF4FF] text-[#0071E3] border border-[#BCD9FF]'
                        : 'bg-[#E5E5EA] text-[#6E6E73]'
                    }`}
                  >
                    {tool.tier}
                  </span>
                </div>
                <p className="text-[11px] text-[#6E6E73] line-clamp-1 font-normal">{tool.description}</p>
              </button>
            );
          })}
        </div>

        {/* JSON Editor & Executor */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-[#F5F5F7] p-3.5 rounded-xl border border-[#E5E5EA] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[#0071E3]" />
                <span className="text-xs font-mono font-semibold text-[#1D1D1F]">{selectedTool.name}</span>
              </div>
              <span className="text-xs text-[#6E6E73]">JSON Parameters</span>
            </div>

            <p className="text-xs text-[#6E6E73] italic">{selectedTool.description}</p>

            <textarea
              rows={4}
              value={paramsInput}
              onChange={(e) => setParamsInput(e.target.value)}
              className="w-full bg-white border border-[#D2D2D7] rounded-lg p-2.5 font-mono text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3]"
            />

            <button
              type="button"
              onClick={handleExecute}
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl bg-[#1D1D1F] hover:bg-[#3A3A3C] text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              {isLoading ? 'Executing Tool...' : 'Invoke WebMCP Tool'}
            </button>
          </div>

          {/* Execution Result */}
          {resultOutput && (
            <div className="bg-[#F5F5F7] p-3.5 rounded-xl border border-[#B6E8C2] text-xs animate-fade-in">
              <div className="flex items-center gap-1.5 text-[#34C759] font-semibold mb-2">
                <CheckCircle2 className="w-4 h-4" /> Tool Execution Result
              </div>
              <pre className="font-mono text-[#1D1D1F] max-h-48 overflow-y-auto text-[11px] bg-white p-2.5 rounded-lg border border-[#E5E5EA]">
                {resultOutput}
              </pre>
            </div>
          )}

          {errorOutput && (
            <div className="bg-[#FFF0EF] p-3.5 rounded-xl border border-[#FFC7C4] text-xs animate-fade-in">
              <div className="flex items-center gap-1.5 text-[#FF3B30] font-semibold mb-1">
                <AlertTriangle className="w-4 h-4" /> Execution Error
              </div>
              <p className="text-[#FF3B30] text-xs">{errorOutput}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
