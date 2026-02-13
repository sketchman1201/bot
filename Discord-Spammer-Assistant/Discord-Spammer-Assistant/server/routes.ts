import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { startSender, stopSender, stopAllSenders, validateToken, getStatus, getAllStatuses, setLogCallback, restoreAllSessions } from "./sender";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import { parse as parseCookie } from "cookie";
import crypto from "crypto";

const sessionClients: Map<string, Set<WebSocket>> = new Map();
const liveStates: Map<string, { token: string; message: string; channelIds: string; delay: number; configName: string; lastUpdate: number }> = new Map();

function getClientsForSession(sessionId: string): Set<WebSocket> {
  let clients = sessionClients.get(sessionId);
  if (!clients) {
    clients = new Set();
    sessionClients.set(sessionId, clients);
  }
  return clients;
}

function broadcastToSession(sessionId: string, data: string) {
  const clients = sessionClients.get(sessionId);
  if (clients) {
    clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}

function broadcastLog(sessionId: string, message: string, level: string) {
  broadcastToSession(sessionId, JSON.stringify({ type: "log", message, level }));
}

function broadcastStatus(sessionId: string) {
  const status = getStatus(sessionId);
  broadcastToSession(sessionId, JSON.stringify({ type: "status", ...status }));
}

function getSessionId(req: any): string {
  return req.cookies?.sender_session || "";
}

function ensureSession(req: any, res: any): string {
  let sessionId = req.cookies?.sender_session;
  if (!sessionId) {
    sessionId = uuidv4();
    res.cookie("sender_session", sessionId, {
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });
  }
  return sessionId;
}

function getAdminToken(): string {
  const secret = process.env.ADMIN_PASSWORD || "";
  const session = process.env.SESSION_SECRET || "fallback";
  return crypto.createHmac("sha256", session).update(secret).digest("hex").substring(0, 32);
}

function isAdmin(req: any): boolean {
  return req.cookies?.admin_auth === getAdminToken();
}

async function checkAccess(sessionId: string): Promise<boolean> {
  const settings = await storage.getSiteSettings();
  if (!settings.isLocked) return true;
  const approved = await storage.getApprovedUser(sessionId);
  return !!approved;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(cookieParser());

  setLogCallback((sessionId, msg, level) => {
    broadcastLog(sessionId, msg, level);
    broadcastStatus(sessionId);
  });

  await restoreAllSessions();

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    const cookies = parseCookie(req.headers.cookie || "");
    const sessionId = cookies.sender_session || "";

    if (!sessionId) {
      ws.close();
      return;
    }

    const hasAccess = await checkAccess(sessionId);
    if (!hasAccess) {
      ws.close();
      return;
    }

    const clients = getClientsForSession(sessionId);
    clients.add(ws);

    const status = getStatus(sessionId);
    ws.send(JSON.stringify({ type: "status", ...status }));

    try {
      const config = await storage.getConfig(sessionId);
      if (config) {
        const recentLogs = await storage.getLogs(config.id, 30);
        if (recentLogs.length > 0) {
          ws.send(JSON.stringify({ type: "logs_history", logs: recentLogs.reverse() }));
        }
      }
    } catch {}

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "state_update") {
          liveStates.set(sessionId, {
            token: msg.token || "",
            message: msg.message || "",
            channelIds: msg.channelIds || "",
            delay: msg.delay || 30,
            configName: msg.configName || "",
            lastUpdate: Date.now(),
          });
        }
      } catch {}
    });

    ws.on("close", () => {
      clients.delete(ws);
      if (clients.size === 0) {
        sessionClients.delete(sessionId);
        liveStates.delete(sessionId);
      }
    });
  });

  app.get("/api/session", (req, res) => {
    const sessionId = ensureSession(req, res);
    res.json({ sessionId });
  });

  app.get("/api/access-status", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      const settings = await storage.getSiteSettings();

      if (!settings.isLocked) {
        return res.json({ locked: false, hasAccess: true, status: "open" });
      }

      const approved = await storage.getApprovedUser(sessionId);
      if (approved) {
        return res.json({ locked: true, hasAccess: true, status: "approved", displayName: approved.displayName });
      }

      const pending = await storage.getAccessRequestBySession(sessionId);
      if (pending) {
        return res.json({ locked: true, hasAccess: false, status: "pending" });
      }

      return res.json({ locked: true, hasAccess: false, status: "none" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/apply", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      const { applicationText } = req.body;

      if (!applicationText || !applicationText.trim()) {
        return res.status(400).json({ message: "Application text is required" });
      }

      const existing = await storage.getAccessRequestBySession(sessionId);
      if (existing) {
        return res.status(400).json({ message: "You already have a pending application" });
      }

      const approved = await storage.getApprovedUser(sessionId);
      if (approved) {
        return res.status(400).json({ message: "You already have access" });
      }

      await storage.createAccessRequest(sessionId, applicationText.trim());
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/config", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      if (!(await checkAccess(sessionId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      let config = await storage.getConfig(sessionId);
      if (!config) {
        config = await storage.upsertConfig(sessionId, { name: "Default Config" });
      }
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/config", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      if (!(await checkAccess(sessionId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { name, token, message, channelIds, delay } = req.body;
      const config = await storage.upsertConfig(sessionId, {
        name: name || "Default Config",
        token: token || "",
        message: message || "",
        channelIds: channelIds || "",
        delay: Math.min(250, Math.max(10, delay || 30)),
      });
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/validate-token", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.json({ valid: false });
      }
      const result = await validateToken(token);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ valid: false, message: err.message });
    }
  });

  app.post("/api/start", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      if (!(await checkAccess(sessionId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { token, message, channelIds, delay } = req.body;
      const result = await startSender(
        sessionId,
        token,
        message,
        channelIds,
        Math.min(250, Math.max(10, delay || 30))
      );

      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/stop", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        return res.status(400).json({ message: "No session" });
      }
      if (!(await checkAccess(sessionId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const result = await stopSender(sessionId);
      broadcastStatus(sessionId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/status", async (req, res) => {
    const sessionId = getSessionId(req);
    res.json(getStatus(sessionId || ""));
  });

  // ===== SAVED CONFIGS =====

  app.get("/api/saved-configs", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      if (!(await checkAccess(sessionId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const saved = await storage.getSavedConfigs(sessionId);
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/saved-configs", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      if (!(await checkAccess(sessionId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { name, token, message, channelIds, delay } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Config name is required" });
      }
      const saved = await storage.createSavedConfig(sessionId, {
        name: name.trim(),
        token: token || "",
        message: message || "",
        channelIds: channelIds || "",
        delay: Math.min(250, Math.max(10, delay || 30)),
      });
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/saved-configs/:id", async (req, res) => {
    try {
      const sessionId = ensureSession(req, res);
      if (!(await checkAccess(sessionId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteSavedConfig(req.params.id, sessionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ===== ADMIN ROUTES =====

  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
      res.cookie("admin_auth", getAdminToken(), {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: "Wrong password" });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    res.clearCookie("admin_auth");
    res.json({ success: true });
  });

  app.get("/api/admin/site-settings", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    const settings = await storage.getSiteSettings();
    res.json(settings);
  });

  app.post("/api/admin/toggle-lock", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const current = await storage.getSiteSettings();
      const newLocked = !current.isLocked;
      const updated = await storage.setSiteLocked(newLocked);

      if (newLocked) {
        await stopAllSenders();

        const allConfigs = await storage.getAllConfigs();
        const allApproved = await storage.getAllApprovedUsers();
        const approvedSessionIds = new Set(allApproved.map(u => u.sessionId));

        for (const config of allConfigs) {
          if (!approvedSessionIds.has(config.sessionId)) {
            await storage.deleteConfig(config.sessionId);
          }
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/members", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const allConfigs = await storage.getAllConfigs();
      const statuses = getAllStatuses();
      const allApproved = await storage.getAllApprovedUsers();

      const members = await Promise.all(
        allConfigs.map(async (config) => {
          const status = statuses.get(config.sessionId);
          const recentLogs = await storage.getLogs(config.id, 20);
          const fullToken = config.token || "";
          const approvedUser = allApproved.find(u => u.sessionId === config.sessionId);
          const rawLiveState = liveStates.get(config.sessionId);
          const isOnline = (sessionClients.get(config.sessionId)?.size || 0) > 0;
          const liveState = rawLiveState && (Date.now() - rawLiveState.lastUpdate < 15000) ? rawLiveState : null;
          return {
            sessionId: config.sessionId.substring(0, 8),
            fullSessionId: config.sessionId,
            configName: config.name,
            displayName: approvedUser?.displayName || null,
            fullToken,
            fullMessage: config.message || "",
            message: config.message ? (config.message.length > 50 ? config.message.substring(0, 50) + "..." : config.message) : "",
            channelIds: config.channelIds,
            delay: config.delay,
            totalSent: config.totalSent,
            isActive: status?.isActive || config.isActive,
            activeThreads: status?.activeThreads || 0,
            startTime: status?.startTime || null,
            createdAt: config.createdAt,
            isOnline,
            liveState: liveState || null,
            recentLogs: recentLogs.reverse().map((l) => ({
              message: l.message,
              level: l.level,
              time: l.createdAt,
            })),
          };
        })
      );

      res.json({ members, totalMembers: members.length, activeMembers: members.filter((m) => m.isActive).length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/applications", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const requests = await storage.getAccessRequests("pending");
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/approve-access", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { requestId, displayName } = req.body;
      if (!requestId || !displayName) {
        return res.status(400).json({ message: "requestId and displayName are required" });
      }
      const requests = await storage.getAccessRequests();
      const request = requests.find(r => r.id === requestId);
      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }
      await storage.updateAccessRequestStatus(requestId, "approved");
      await storage.addApprovedUser(request.sessionId, displayName);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/deny-access", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { requestId } = req.body;
      if (!requestId) {
        return res.status(400).json({ message: "requestId is required" });
      }
      await storage.updateAccessRequestStatus(requestId, "denied");
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/approved-users", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const users = await storage.getAllApprovedUsers();
      res.json(users);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/update-user-name", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { userId, displayName } = req.body;
      if (!userId || !displayName) {
        return res.status(400).json({ message: "userId and displayName are required" });
      }
      await storage.updateApprovedUserName(userId, displayName);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/block-user", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }
      const users = await storage.getAllApprovedUsers();
      const user = users.find(u => u.id === userId);
      if (user) {
        await stopSender(user.sessionId);
      }
      await storage.removeApprovedUser(userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/stop-all-senders", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const stopped = await stopAllSenders();
      res.json({ success: true, stopped });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/remove-config", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }
      await stopSender(sessionId);
      await storage.deleteConfig(sessionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/clear-idle", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const allConfigs = await storage.getAllConfigs();
      const statuses = getAllStatuses();
      let cleared = 0;
      for (const config of allConfigs) {
        const status = statuses.get(config.sessionId);
        const isActive = status?.isActive || config.isActive;
        if (!isActive) {
          await stopSender(config.sessionId);
          await storage.deleteConfig(config.sessionId);
          cleared++;
        }
      }
      res.json({ success: true, cleared });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/stop-sender", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }
      await stopSender(sessionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/live-state/:sessionId", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    const { sessionId } = req.params;
    const live = liveStates.get(sessionId);
    const isOnline = (sessionClients.get(sessionId)?.size || 0) > 0;
    res.json({ live: live || null, isOnline });
  });

  app.post("/api/admin/update-config", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { sessionId, token, message, channelIds, delay } = req.body;
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }
      const config = await storage.upsertConfig(sessionId, {
        token: token ?? "",
        message: message ?? "",
        channelIds: channelIds ?? "",
        delay: Math.min(250, Math.max(10, delay || 30)),
      });

      const clients = sessionClients.get(sessionId);
      if (clients) {
        const updateMsg = JSON.stringify({
          type: "config_update",
          token,
          message,
          channelIds,
          delay,
        });
        clients.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(updateMsg);
          }
        });
      }

      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/start-sender", async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { sessionId, token, message, channelIds, delay } = req.body;
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }

      await storage.upsertConfig(sessionId, {
        token: token || "",
        message: message || "",
        channelIds: channelIds || "",
        delay: Math.min(250, Math.max(10, delay || 30)),
      });

      const result = await startSender(
        sessionId,
        token,
        message,
        channelIds,
        Math.min(250, Math.max(10, delay || 30))
      );

      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
