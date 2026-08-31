import { useState } from 'react';
import { Bot, Play, CheckCircle2, AlertTriangle, Code2, Sparkles } from 'lucide-react';
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

    // Provide helpful pre-filled templates
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
        setParamsInput('{\n  "alertId": "alt-test",\n  "content": "Investigated heap dump, no leak detected."\n}');
        break;
      case 'restart_service':
        setParamsInput('{\n  "serviceId": "payment-service",\n  "reason": "High error rate threshold exceeded, initiating rolling restart"\n}');
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
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">WebMCP Agent Test Console</h3>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
                7 Tools Registered
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Invoke registered WebMCP tools directly as an AI agent operating in this browser session
            </p>
          </div>
        </div>
      </div>

      {/* Quick Scenario Runner */}
      <div className="mb-4 bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Test Scenarios:
        </span>

        <button
          onClick={() => {
            const tool = tools.find((t) => t.name === 'get_service_health')!;
            handleToolSelect(tool);
            setParamsInput('{\n  "serviceId": "auth-service"\n}');
          }}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 cursor-pointer"
        >
          Check Auth Health (Read)
        </button>

        <button
          onClick={() => {
            const tool = tools.find((t) => t.name === 'restart_service')!;
            handleToolSelect(tool);
            setParamsInput('{\n  "serviceId": "payment-service",\n  "reason": "Clear transient memory leak under peak load"\n}');
          }}
          className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs rounded-lg border border-amber-500/30 font-semibold cursor-pointer"
        >
          Restart Payment API (High-Risk Flow)
        </button>

        <button
          onClick={() => {
            const tool = tools.find((t) => t.name === 'scale_service')!;
            handleToolSelect(tool);
            setParamsInput('{\n  "serviceId": "inventory-service",\n  "replicas": 6,\n  "reason": "Scale out for warehouse surge"\n}');
          }}
          className="px-2.5 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 text-xs rounded-lg border border-indigo-500/30 font-semibold cursor-pointer"
        >
          Scale Inventory Replicas (High-Risk)
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tool Selector List */}
        <div className="space-y-1.5 bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-80 overflow-y-auto">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Available WebMCP Tools
          </label>
          {tools.map((tool) => {
            const isSelected = tool.name === selectedToolName;
            return (
              <button
                key={tool.name}
                onClick={() => handleToolSelect(tool)}
                className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex flex-col gap-1 cursor-pointer ${
                  isSelected
                    ? 'bg-purple-950/40 border border-purple-500/50 text-white font-semibold'
                    : 'hover:bg-slate-900 border border-transparent text-slate-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-purple-300">{tool.name}</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
                      tool.tier === 'high-risk'
                        ? 'bg-amber-500/20 text-amber-400'
                        : tool.tier === 'low-risk'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tool.tier}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-1 font-normal">{tool.description}</p>
              </button>
            );
          })}
        </div>

        {/* Parameter Input and Execution */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-mono font-bold text-white">{selectedTool.name}</span>
              </div>
              <span className="text-xs text-slate-400">JSON Input Parameters</span>
            </div>

            <p className="text-xs text-slate-400 italic">{selectedTool.description}</p>

            <textarea
              rows={4}
              value={paramsInput}
              onChange={(e) => setParamsInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg p-2.5 font-mono text-xs text-cyan-300 focus:outline-none focus:border-purple-500"
            />

            <button
              onClick={handleExecute}
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-500/20 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-white" />
              {isLoading ? 'Executing Tool...' : 'Invoke WebMCP Tool'}
            </button>
          </div>

          {/* Execution Output */}
          {resultOutput && (
            <div className="bg-slate-950 p-3.5 rounded-xl border border-emerald-500/40 text-xs animate-fade-in">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold mb-2">
                <CheckCircle2 className="w-4 h-4" /> Tool Execution Result
              </div>
              <pre className="font-mono text-emerald-300 max-h-48 overflow-y-auto overflow-x-auto text-[11px] bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                {resultOutput}
              </pre>
            </div>
          )}

          {errorOutput && (
            <div className="bg-slate-950 p-3.5 rounded-xl border border-rose-500/40 text-xs animate-fade-in">
              <div className="flex items-center gap-1.5 text-rose-400 font-bold mb-1">
                <AlertTriangle className="w-4 h-4" /> Tool Execution Failed
              </div>
              <p className="text-rose-300 text-xs bg-rose-950/40 p-2 rounded border border-rose-900/50">
                {errorOutput}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
