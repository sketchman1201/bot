import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Play, Square, Save, FolderOpen, Terminal, Lock, Send, Clock, ChevronRight, ShieldCheck, FileText, User, Trash2, X, Download, Zap, Hash, MessageSquare, Key, Timer, Activity } from "lucide-react";
import type { Config, SavedConfig } from "@shared/schema";

interface AccessStatus {
  locked: boolean;
  hasAccess: boolean;
  status: "open" | "approved" | "pending" | "none";
  displayName?: string;
}

export default function Home() {
  const { toast } = useToast();
  const [tokenVisible, setTokenVisible] = useState(false);
  const [configName, setConfigName] = useState("Default Config");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [channelIds, setChannelIds] = useState("");
  const [delay, setDelay] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [totalSent, setTotalSent] = useState(0);
  const [activeThreads, setActiveThreads] = useState(0);
  const [uptime, setUptime] = useState("HALTED");
  const [systemLogs, setSystemLogs] = useState<Array<{ message: string; level: string; time: string }>>([]);
  const [tokenStatus, setTokenStatus] = useState<"idle" | "valid" | "invalid" | "checking">("idle");
  const [applicationText, setApplicationText] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showSavedConfigs, setShowSavedConfigs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const uptimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const tokenValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: accessStatus, isLoading: accessLoading } = useQuery<AccessStatus>({
    queryKey: ["/api/access-status"],
    refetchInterval: 10000,
  });

  const { data: config, refetch: refetchConfig } = useQuery<Config>({
    queryKey: ["/api/config"],
    enabled: !accessStatus?.locked || accessStatus?.hasAccess,
  });

  const { data: statusData, refetch: refetchStatus } = useQuery<{
    isActive: boolean;
    totalSent: number;
    activeThreads: number;
    startTime: number | null;
  }>({
    queryKey: ["/api/status"],
    refetchInterval: 3000,
    enabled: !accessStatus?.locked || accessStatus?.hasAccess,
  });

  const { data: savedConfigsList, refetch: refetchSaved } = useQuery<SavedConfig[]>({
    queryKey: ["/api/saved-configs"],
    enabled: !accessStatus?.locked || accessStatus?.hasAccess,
  });

  useEffect(() => {
    if (config && !configLoaded) {
      setConfigName(config.name);
      setToken(config.token);
      setMessage(config.message);
      setChannelIds(config.channelIds);
      setDelay(config.delay);
      setTotalSent(config.totalSent);
      setIsRunning(config.isActive);
      setConfigLoaded(true);
      if (config.token) {
        setTokenStatus("valid");
      }
    }
  }, [config, configLoaded]);

  useEffect(() => {
    if (statusData) {
      setIsRunning(statusData.isActive);
      setTotalSent(statusData.totalSent);
      setActiveThreads(statusData.activeThreads);
      if (statusData.startTime) {
        startTimeRef.current = statusData.startTime;
      }
    }
  }, [statusData]);

  useEffect(() => {
    if (isRunning && startTimeRef.current) {
      uptimeIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - (startTimeRef.current || Date.now())) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        setUptime(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
      }, 1000);
    } else {
      setUptime("HALTED");
      if (uptimeIntervalRef.current) clearInterval(uptimeIntervalRef.current);
    }
    return () => {
      if (uptimeIntervalRef.current) clearInterval(uptimeIntervalRef.current);
    };
  }, [isRunning]);

  const addLog = useCallback((msg: string, level: string = "info") => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setSystemLogs((prev) => [...prev.slice(-100), { message: msg, level, time }]);
  }, []);

  const liveStateRef = useRef({ token: "", message: "", channelIds: "", delay: 30, configName: "Default Config" });

  useEffect(() => {
    liveStateRef.current = { token, message, channelIds, delay, configName };
  }, [token, message, channelIds, delay, configName]);

  const sendLiveState = useCallback((ws?: WebSocket) => {
    const target = ws || wsRef.current;
    if (target && target.readyState === WebSocket.OPEN) {
      target.send(JSON.stringify({
        type: "state_update",
        token: liveStateRef.current.token,
        message: liveStateRef.current.message,
        channelIds: liveStateRef.current.channelIds,
        delay: liveStateRef.current.delay,
        configName: liveStateRef.current.configName,
      }));
    }
  }, []);

  useEffect(() => {
    if (accessStatus?.locked && !accessStatus?.hasAccess) return;

    let destroyed = false;

    async function initSession() {
      try {
        await fetch("/api/session", { credentials: "include" });
      } catch {}
      if (!destroyed) connect();
    }

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        addLog("WebSocket connection established", "info");
        sendLiveState(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log") {
            addLog(data.message, data.level);
          } else if (data.type === "status") {
            setIsRunning(data.isActive);
            setTotalSent(data.totalSent);
            setActiveThreads(data.activeThreads);
            if (data.startTime) startTimeRef.current = data.startTime;
          } else if (data.type === "config_update") {
            if (data.token !== undefined) setToken(data.token);
            if (data.message !== undefined) setMessage(data.message);
            if (data.channelIds !== undefined) setChannelIds(data.channelIds);
            if (data.delay !== undefined) setDelay(data.delay);
            addLog("Config updated remotely by admin", "warn");
          } else if (data.type === "logs_history") {
            data.logs.forEach((l: { message: string; level: string; createdAt: string }) => {
              addLog(l.message, l.level);
            });
          }
        } catch {
          addLog(event.data, "info");
        }
      };

      ws.onclose = () => {
        if (!destroyed) {
          addLog("WebSocket disconnected, reconnecting...", "warn");
          setTimeout(() => {
            if (!destroyed) connect();
          }, 3000);
        }
      };
    }

    initSession();

    const stateInterval = setInterval(() => sendLiveState(), 1000);

    return () => {
      destroyed = true;
      wsRef.current?.close();
      clearInterval(stateInterval);
    };
  }, [addLog, accessStatus, sendLiveState]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [systemLogs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/config", {
        name: configName,
        token,
        message,
        channelIds,
        delay,
      });
      await apiRequest("POST", "/api/saved-configs", {
        name: configName,
        token,
        message,
        channelIds,
        delay,
      });
    },
    onSuccess: () => {
      addLog("Configuration saved to presets", "success");
      toast({ title: "Config saved" });
      refetchSaved();
    },
    onError: (err: Error) => {
      addLog(`Failed to save config: ${err.message}`, "error");
    },
  });

  const deleteSavedMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-configs/${id}`);
    },
    onSuccess: () => {
      addLog("Saved config deleted", "info");
      toast({ title: "Config deleted" });
      refetchSaved();
    },
    onError: (err: Error) => {
      addLog(`Failed to delete config: ${err.message}`, "error");
    },
  });

  const loadSavedConfig = (saved: SavedConfig) => {
    setConfigName(saved.name);
    setToken(saved.token);
    setMessage(saved.message);
    setChannelIds(saved.channelIds);
    setDelay(saved.delay);
    setShowSavedConfigs(false);
    if (saved.token && saved.token.length > 20) {
      setTokenStatus("valid");
    } else {
      setTokenStatus("idle");
    }
    addLog(`Loaded config: ${saved.name}`, "success");
    toast({ title: `Loaded: ${saved.name}` });
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/start", {
        token,
        message,
        channelIds,
        delay,
      });
      return res;
    },
    onSuccess: () => {
      setIsRunning(true);
      startTimeRef.current = Date.now();
      addLog("Protocol initiated - System active", "success");
      refetchStatus();
      toast({ title: "System started" });
    },
    onError: (err: Error) => {
      refetchStatus();
      addLog(`Failed to start: ${err.message}`, "error");
      toast({ title: "Failed to start", description: err.message, variant: "destructive" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/stop");
    },
    onSuccess: () => {
      setIsRunning(false);
      setActiveThreads(0);
      startTimeRef.current = null;
      addLog("System halted", "warn");
      setTimeout(() => {
        refetchStatus();
        queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      }, 500);
      toast({ title: "System stopped" });
    },
    onError: (err: Error) => {
      addLog(`Failed to stop: ${err.message}`, "error");
      refetchStatus();
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/apply", { applicationText });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-status"] });
      setApplicationText("");
      toast({ title: "Application sent!" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to apply", description: err.message, variant: "destructive" });
    },
  });

  const validateTokenFn = async (t: string) => {
    if (!t || t.length < 20) {
      setTokenStatus("idle");
      return;
    }
    setTokenStatus("checking");
    try {
      const res = await apiRequest("POST", "/api/validate-token", { token: t });
      const data = await res.json();
      if (data.valid) {
        setTokenStatus("valid");
        addLog(`Token validated: ${data.username}#${data.discriminator}`, "success");
      } else {
        setTokenStatus("invalid");
        addLog("Token validation failed - Invalid token", "error");
      }
    } catch {
      setTokenStatus("invalid");
      addLog("Token validation failed", "error");
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case "success": return "text-emerald-400";
      case "error": return "text-red-400";
      case "warn": return "text-amber-400";
      default: return "text-slate-400";
    }
  };

  const channelCount = channelIds.split(/[,\n]/).filter((id) => id.trim()).length;

  if (accessLoading) {
    return (
      <div className="min-h-screen page-bg flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin mx-auto" />
          <div className="text-[11px] tracking-widest text-slate-500">LOADING</div>
        </div>
      </div>
    );
  }

  if (accessStatus?.locked && !accessStatus?.hasAccess) {
    return (
      <div className="min-h-screen page-bg flex items-center justify-center">
        <div className="max-w-md mx-auto px-4 space-y-8 text-center">
          <div className="space-y-4">
            <Lock className="w-12 h-12 mx-auto text-slate-600" />
            <h1 className="text-xl font-semibold tracking-wider text-slate-300" data-testid="text-locked-title">
              ACCESS RESTRICTED
            </h1>
          </div>

          {accessStatus.status === "pending" ? (
            <div className="panel p-6 text-left space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold tracking-wider text-amber-400">PENDING REVIEW</span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Your application has been submitted and is waiting for review.
              </p>
            </div>
          ) : (
            <div className="panel overflow-visible text-left">
              <div className="flex items-center gap-2 px-5 py-3.5 panel-header">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold tracking-wider text-slate-300">APPLY FOR ACCESS</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-slate-500 leading-relaxed">
                  This tool is currently restricted. Submit an application to request access.
                </p>
                <Textarea
                  value={applicationText}
                  onChange={(e) => setApplicationText(e.target.value)}
                  className="clean-input text-slate-200 placeholder:text-slate-600 resize-none min-h-[100px] focus-visible:ring-indigo-500/20"
                  placeholder="Tell us why you need access..."
                  data-testid="input-application"
                />
                <Button
                  onClick={() => applyMutation.mutate()}
                  disabled={applyMutation.isPending || !applicationText.trim()}
                  className="w-full no-default-hover-elevate no-default-active-elevate"
                  style={{ background: "#6366f1", borderColor: "#4f46e5", color: "#fff" }}
                  data-testid="button-submit-application"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {applyMutation.isPending ? "SUBMITTING..." : "SUBMIT APPLICATION"}
                </Button>
              </div>
            </div>
          )}

          <div className="text-[10px] tracking-widest text-slate-700">
            <span data-testid="text-credits">made by velta</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-bg">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-4 relative">

        <header className="text-center space-y-2 pb-3">
          <h1 className="text-xl font-semibold tracking-[0.2em] text-slate-200" data-testid="text-title">
            AUTO_SENDER
          </h1>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isRunning ? "status-dot" : ""}`}
                style={{ background: isRunning ? "#34d399" : "#475569" }}
              />
              <span style={{ color: isRunning ? "#34d399" : "#64748b" }}>
                {isRunning ? "ACTIVE" : "STANDBY"}
              </span>
            </span>
            {accessStatus?.displayName && (
              <span className="text-[11px] text-slate-500">{accessStatus.displayName}</span>
            )}
            <span className="text-[10px] text-slate-700">v2.1</span>
          </div>
        </header>

        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-slate-800 bg-slate-900/50 text-slate-400 no-default-hover-elevate no-default-active-elevate hover:bg-slate-800/50 hover:text-slate-300"
              onClick={() => setShowSavedConfigs(!showSavedConfigs)}
              data-testid="button-load-config"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              {showSavedConfigs ? "CLOSE" : "LOAD CONFIG"}
            </Button>
            <Button
              className="flex-1 no-default-hover-elevate no-default-active-elevate hover:opacity-90"
              style={{ background: "#6366f1", borderColor: "#4f46e5", color: "#fff" }}
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !configName.trim()}
              data-testid="button-save-config"
            >
              <Save className="w-4 h-4 mr-2" />
              SAVE CONFIG
            </Button>
          </div>

          {showSavedConfigs && (
            <div className="panel overflow-visible">
              <div className="flex items-center justify-between px-4 py-2.5 panel-header">
                <span className="text-[11px] font-semibold tracking-wider text-slate-400">SAVED CONFIGS</span>
                <button onClick={() => setShowSavedConfigs(false)} className="text-slate-600 hover:text-slate-400" data-testid="button-close-saved">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {!savedConfigsList || savedConfigsList.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[11px] text-slate-600">
                    No saved configs yet.
                  </div>
                ) : (
                  savedConfigsList.map((sc) => (
                    <div
                      key={sc.id}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
                      data-testid={`saved-config-${sc.id}`}
                    >
                      <div
                        className="flex-1 min-w-0"
                        onClick={() => loadSavedConfig(sc)}
                        data-testid={`button-load-saved-${sc.id}`}
                      >
                        <div className="text-sm font-medium truncate text-slate-300">{sc.name}</div>
                        <div className="text-[11px] truncate text-slate-600">
                          {sc.delay}s delay
                          {sc.channelIds ? ` / ${sc.channelIds.split(/[,\n]/).filter(c => c.trim()).length} ch` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); loadSavedConfig(sc); }}
                          className="no-default-hover-elevate text-indigo-400"
                          data-testid={`button-apply-saved-${sc.id}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); deleteSavedMutation.mutate(sc.id); }}
                          className="no-default-hover-elevate text-red-500/50"
                          data-testid={`button-delete-saved-${sc.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="panel overflow-visible">
          <div className="flex items-center justify-between px-5 py-3 panel-header">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[11px] font-semibold tracking-wider text-slate-300">CONTROL PANEL</span>
            </div>
          </div>

          <div className="p-5 space-y-5">
            <div>
              <label className="text-[10px] font-medium tracking-wider mb-1.5 flex items-center gap-1.5 text-slate-500">
                <FileText className="w-3 h-3" /> CONFIG NAME
              </label>
              <Input
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
                className="clean-input text-slate-200 placeholder:text-slate-600 focus-visible:ring-indigo-500/20"
                placeholder="Default Config"
                data-testid="input-config-name"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium tracking-wider mb-1.5 flex items-center justify-between text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Key className="w-3 h-3" /> TOKEN
                </span>
                <span className="text-[10px] font-semibold" style={{
                  color: tokenStatus === "valid" ? "#34d399" :
                    tokenStatus === "invalid" ? "#f87171" :
                      tokenStatus === "checking" ? "#fbbf24" : "#64748b"
                }}>
                  {tokenStatus === "valid" ? "VERIFIED" :
                    tokenStatus === "invalid" ? "INVALID" :
                      tokenStatus === "checking" ? "CHECKING..." : "REQUIRED"}
                </span>
              </label>
              <div className="relative">
                <Input
                  type={tokenVisible ? "text" : "password"}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (tokenValidateTimer.current) clearTimeout(tokenValidateTimer.current);
                    if (e.target.value.length > 20) {
                      tokenValidateTimer.current = setTimeout(() => validateTokenFn(e.target.value), 800);
                    } else {
                      setTokenStatus("idle");
                    }
                  }}
                  className="clean-input text-slate-200 placeholder:text-slate-600 pr-10 focus-visible:ring-indigo-500/20"
                  placeholder="Discord User Token"
                  data-testid="input-token"
                />
                <button
                  type="button"
                  onClick={() => setTokenVisible(!tokenVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                  data-testid="button-toggle-token"
                >
                  {tokenVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-medium tracking-wider mb-1.5 flex items-center gap-1.5 text-slate-500">
                <MessageSquare className="w-3 h-3" /> MESSAGE
              </label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="clean-input text-slate-200 placeholder:text-slate-600 resize-none min-h-[100px] focus-visible:ring-indigo-500/20"
                placeholder="Type your message content here..."
                data-testid="input-message"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium tracking-wider mb-1.5 flex items-center justify-between text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Hash className="w-3 h-3" /> CHANNELS
                </span>
                <span className="text-slate-600">comma / newline</span>
              </label>
              <Textarea
                value={channelIds}
                onChange={(e) => setChannelIds(e.target.value)}
                className="clean-input text-slate-200 placeholder:text-slate-600 resize-none min-h-[80px] focus-visible:ring-indigo-500/20"
                placeholder="Channel ID 1, Channel ID 2, ..."
                data-testid="input-channels"
              />
              {channelCount > 0 && channelIds.trim() && (
                <span className="text-[11px] mt-1 block text-slate-600">
                  {channelCount} channel(s) configured
                </span>
              )}
            </div>

            <div>
              <label className="text-[10px] font-medium tracking-wider mb-1.5 flex items-center justify-between text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Timer className="w-3 h-3" /> INTERVAL
                </span>
                <span className="text-sm font-semibold text-slate-300">
                  {delay}<span className="text-[10px] ml-0.5 font-normal text-slate-600">s</span>
                </span>
              </label>
              <Slider
                value={[delay]}
                min={10}
                max={250}
                step={1}
                onValueChange={(v) => setDelay(v[0])}
                className="mt-1"
                data-testid="slider-delay"
              />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-slate-700">10s</span>
                <span className="text-[10px] text-slate-700">250s</span>
              </div>
            </div>

            <div className="fade-separator" />

            <div className="flex gap-2">
              <Button
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending || isRunning || !token || !message || !channelIds}
                className="flex-1 no-default-hover-elevate no-default-active-elevate"
                style={{
                  background: isRunning ? "rgba(99,102,241,0.1)" : "#6366f1",
                  borderColor: isRunning ? "rgba(99,102,241,0.15)" : "#4f46e5",
                  color: isRunning ? "rgba(99,102,241,0.3)" : "#fff",
                }}
                data-testid="button-initiate"
              >
                <Play className="w-4 h-4 mr-2" />
                INITIATE
              </Button>
              <Button
                variant="outline"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending || !isRunning}
                className="flex-1 no-default-hover-elevate no-default-active-elevate"
                style={{
                  borderColor: isRunning ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.1)",
                  color: isRunning ? "#f87171" : "rgba(239,68,68,0.2)",
                  background: isRunning ? "rgba(239,68,68,0.08)" : "transparent",
                }}
                data-testid="button-abort"
              >
                <Square className="w-4 h-4 mr-2" />
                ABORT
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="panel p-4 text-center">
            <div className="text-[10px] tracking-wider mb-1 text-slate-600 uppercase">Threads</div>
            <div className="text-lg font-semibold" style={{ color: isRunning ? "#34d399" : "#64748b" }} data-testid="text-status">
              {activeThreads}
            </div>
          </div>
          <div className="panel p-4 text-center">
            <div className="text-[10px] tracking-wider mb-1 text-slate-600 uppercase">Sent</div>
            <div className="text-lg font-semibold text-slate-300" data-testid="text-total-sent">
              {totalSent}
            </div>
          </div>
          <div className="panel p-4 text-center">
            <div className="text-[10px] tracking-wider mb-1 text-slate-600 uppercase">Uptime</div>
            <div className="text-sm font-semibold font-mono" style={{ color: isRunning ? "#34d399" : "#64748b" }} data-testid="text-uptime">
              {uptime}
            </div>
          </div>
        </div>

        <div className="panel overflow-visible">
          <div className="flex items-center justify-between px-5 py-3 panel-header">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold tracking-wider text-slate-400">SYSTEM LOGS</span>
            </div>
            <span
              className={`w-1.5 h-1.5 rounded-full ${isRunning ? "status-dot" : ""}`}
              style={{ background: isRunning ? "#34d399" : "#ef4444" }}
            />
          </div>
          <div
            className="h-[200px] overflow-y-auto px-5 py-4 font-mono text-[11px] space-y-0.5"
            style={{ background: "rgba(4, 4, 12, 0.6)" }}
            data-testid="container-system-logs"
          >
            {systemLogs.length === 0 ? (
              <div className="text-slate-700 italic">Awaiting system initiation...</div>
            ) : (
              systemLogs.map((log, i) => (
                <div key={i} className={`${getLogColor(log.level)} leading-relaxed`}>
                  <span className="text-slate-700">[{log.time}]</span> {log.message}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        <div className="flex items-center justify-between py-4 px-1 text-[10px] text-slate-700">
          <a href="/admin" className="hover:text-slate-500 transition-colors tracking-widest" data-testid="link-admin">ADMIN</a>
          <span className="tracking-widest" data-testid="text-credits">made by velta</span>
        </div>
      </div>
    </div>
  );
}
