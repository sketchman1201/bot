import { storage } from "./storage";

interface SessionSender {
  isActive: boolean;
  totalSent: number;
  activeThreads: number;
  startTime: number | null;
  shouldStop: boolean;
  sessionId: string;
}

type LogCallback = (sessionId: string, message: string, level: string) => void;

const sessions: Map<string, SessionSender> = new Map();
let logCallback: LogCallback = () => {};

export function setLogCallback(cb: LogCallback) {
  logCallback = cb;
}

function getSession(sessionId: string): SessionSender {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      isActive: false,
      totalSent: 0,
      activeThreads: 0,
      startTime: null,
      shouldStop: false,
      sessionId,
    };
    sessions.set(sessionId, s);
  }
  return s;
}

function emitLog(sessionId: string, msg: string, level: string = "info") {
  logCallback(sessionId, msg, level);
  storage.getConfig(sessionId).then((config) => {
    if (config) {
      storage.addLog(config.id, msg, level).catch(() => {});
    }
  }).catch(() => {});
}

export function getStatus(sessionId: string) {
  const s = getSession(sessionId);
  return {
    isActive: s.isActive,
    totalSent: s.totalSent,
    activeThreads: s.activeThreads,
    startTime: s.startTime,
  };
}

export function getAllStatuses(): Map<string, { isActive: boolean; totalSent: number; activeThreads: number; startTime: number | null }> {
  const result = new Map();
  sessions.forEach((s, id) => {
    result.set(id, {
      isActive: s.isActive,
      totalSent: s.totalSent,
      activeThreads: s.activeThreads,
      startTime: s.startTime,
    });
  });
  return result;
}

function interruptibleSleep(sessionId: string, ms: number): Promise<boolean> {
  const s = getSession(sessionId);
  return new Promise((resolve) => {
    if (s.shouldStop) {
      resolve(false);
      return;
    }
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(checkInterval);
        resolve(true);
      }
    }, ms);
    const checkInterval = setInterval(() => {
      if (s.shouldStop && !resolved) {
        resolved = true;
        clearTimeout(timer);
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 200);
  });
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const channelNames: Map<string, string> = new Map();

async function fetchChannelName(token: string, channelId: string): Promise<string> {
  const cached = channelNames.get(channelId);
  if (cached) return cached;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: {
        Authorization: token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (res.ok) {
      const data = await res.json();
      const name = data.name || channelId;
      channelNames.set(channelId, name);
      return name;
    }
  } catch {}
  return channelId;
}

async function sendOneMessage(
  sessionId: string,
  token: string,
  channelId: string,
  content: string,
  chName: string
): Promise<{ sent: boolean; cooldownMs: number }> {
  const s = getSession(sessionId);
  if (s.shouldStop) return { sent: false, cooldownMs: 0 };

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({ content, tts: false }),
      }
    );

    if (response.ok) {
      return { sent: true, cooldownMs: 0 };
    }

    if (response.status === 429) {
      const data = await response.json().catch(() => ({ retry_after: 5 }));
      const retryAfter = data.retry_after || 5;
      return { sent: false, cooldownMs: Math.ceil(retryAfter * 1000) + 1000 };
    }

    if (response.status === 401) {
      return { sent: false, cooldownMs: -401 };
    }

    if (response.status === 403) {
      emitLog(sessionId, `No permission for #${chName} - will retry later`, "warn");
      return { sent: false, cooldownMs: -1 };
    }

    return { sent: false, cooldownMs: 5000 };
  } catch (err: any) {
    emitLog(sessionId, `Network error on #${chName}: ${err.message}`, "warn");
    return { sent: false, cooldownMs: 5000 };
  }
}

async function channelLoop(
  sessionId: string,
  token: string,
  channelId: string,
  content: string,
  chName: string,
  delaySeconds: number
): Promise<"stopped" | "token_invalid" | "done"> {
  const s = getSession(sessionId);
  let consecutiveErrors = 0;

  while (!s.shouldStop) {
    const result = await sendOneMessage(sessionId, token, channelId, content, chName);
    if (s.shouldStop) return "stopped";

    if (result.cooldownMs === -401) {
      return "token_invalid";
    }

    if (result.sent) {
      consecutiveErrors = 0;
      s.totalSent++;
      storage.incrementSent(sessionId).catch(() => {});
      emitLog(sessionId, `Delivered to #${chName} [Total: ${s.totalSent}]`, "success");

      const waitSec = Math.ceil(rand(delaySeconds * 0.9, delaySeconds * 1.1));
      const continued = await interruptibleSleep(sessionId, waitSec * 1000);
      if (!continued) return "stopped";
    } else {
      consecutiveErrors++;
      const waitMs = result.cooldownMs > 0
        ? result.cooldownMs
        : result.cooldownMs === -1
          ? 60000
          : Math.min(10000 * consecutiveErrors, 120000);
      const waitSec = Math.ceil(waitMs / 1000);

      if (waitSec > 5) {
        emitLog(sessionId, `#${chName} waiting ${waitSec}s before retry`, "warn");
      }
      const continued = await interruptibleSleep(sessionId, waitMs);
      if (!continued) return "stopped";
    }
  }
  return "stopped";
}

async function senderLoop(
  sessionId: string,
  token: string,
  message: string,
  channelIds: string[],
  delaySeconds: number
): Promise<"stopped" | "token_invalid"> {
  const s = getSession(sessionId);
  s.activeThreads = channelIds.length;

  const names: string[] = [];
  for (const id of channelIds) {
    if (s.shouldStop) return "stopped";
    const name = await fetchChannelName(token, id);
    names.push(name);
  }
  emitLog(sessionId, `Resolved channels: ${names.map(n => "#" + n).join(", ")}`, "info");
  emitLog(sessionId, `Sender active - ${channelIds.length} channel(s), ${delaySeconds}s delay each`, "success");

  const channelPromises = channelIds.map((channelId, i) => {
    const chName = names[i] || channelId;
    const stagger = i * 2000;
    return interruptibleSleep(sessionId, stagger).then(continued => {
      if (!continued) return "stopped" as const;
      return channelLoop(sessionId, token, channelId, message, chName, delaySeconds);
    });
  });

  const results = await Promise.all(channelPromises);
  
  if (results.some(r => r === "token_invalid")) {
    s.shouldStop = true;
    return "token_invalid";
  }

  emitLog(sessionId, "All channel loops ended", "warn");
  return "stopped";
}

export async function startSender(
  sessionId: string,
  token: string,
  message: string,
  channelIdsStr: string,
  delay: number,
  isRestore: boolean = false
): Promise<{ success: boolean; error?: string }> {
  const s = getSession(sessionId);

  if (s.isActive && s.shouldStop) {
    let waited = 0;
    while (s.isActive && waited < 5000) {
      await new Promise(r => setTimeout(r, 300));
      waited += 300;
    }
  }

  if (s.isActive) {
    return { success: false, error: "Sender is already running" };
  }

  const channelIds = channelIdsStr
    .split(/[,\n]/)
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));

  if (channelIds.length === 0) {
    return { success: false, error: "No valid channel IDs provided" };
  }
  if (!token) {
    return { success: false, error: "Token is required" };
  }
  if (!message) {
    return { success: false, error: "Message content is required" };
  }

  s.isActive = true;
  s.shouldStop = false;
  s.startTime = Date.now();

  await storage.updateConfigStatus(sessionId, true);
  await storage.setUserWantsActive(sessionId, true);
  await storage.upsertConfig(sessionId, { token, message, channelIds: channelIdsStr, delay });

  if (isRestore) {
    emitLog(sessionId, "Auto-resumed from previous session", "success");
  } else {
    emitLog(sessionId, "System initialized - Protocol active", "success");
  }
  emitLog(sessionId, `Config: ${channelIds.length} target(s), ${delay}s delay`, "info");

  (async () => {
    let loopResult: "stopped" | "token_invalid" = "stopped";
    try {
      loopResult = await senderLoop(sessionId, token, message, channelIds, delay);
    } catch (err: any) {
      emitLog(sessionId, `Sender error: ${err.message}`, "error");
    } finally {
      const userWantedStop = s.shouldStop;
      s.isActive = false;
      s.activeThreads = 0;
      s.startTime = null;
      s.shouldStop = false;
      await storage.updateConfigStatus(sessionId, false);

      if (loopResult === "token_invalid") {
        await storage.setUserWantsActive(sessionId, false);
        emitLog(sessionId, "TOKEN INVALID - Sender stopped. Your token is invalid or has been changed. Please update your token and restart.", "error");
      } else if (!userWantedStop) {
        let retryNum = 0;
        while (true) {
          retryNum++;
          const waitTime = Math.min(retryNum * 5, 60);
          emitLog(sessionId, `Unexpected stop - auto-restart #${retryNum} in ${waitTime}s...`, "warn");
          const continued = await interruptibleSleep(sessionId, waitTime * 1000);
          if (!continued) break;
          const config = await storage.getConfig(sessionId);
          if (!config || !config.userWantsActive) {
            emitLog(sessionId, "Auto-restart cancelled - user stopped or config removed", "warn");
            break;
          }
          if (!config.token || !config.message || !config.channelIds) {
            emitLog(sessionId, "Auto-restart waiting - incomplete config", "warn");
            continue;
          }
          emitLog(sessionId, "Auto-restarting sender...", "success");
          const result = await startSender(sessionId, config.token, config.message, config.channelIds, config.delay, true);
          if (result.success) break;
          emitLog(sessionId, `Restart failed: ${result.error} - will retry`, "warn");
        }
      } else {
        emitLog(sessionId, "System shutdown complete", "warn");
      }
    }
  })();

  return { success: true };
}

export async function stopSender(sessionId: string): Promise<{ success: boolean }> {
  const s = getSession(sessionId);
  if (!s.isActive) {
    return { success: false };
  }

  emitLog(sessionId, "Abort signal received - shutting down...", "warn");
  s.shouldStop = true;
  await storage.setUserWantsActive(sessionId, false);

  return { success: true };
}

export async function validateToken(token: string): Promise<{
  valid: boolean;
  username?: string;
  discriminator?: string;
}> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: {
        Authorization: token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (res.ok) {
      const data = await res.json();
      return { valid: true, username: data.username, discriminator: data.discriminator || "0" };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

export async function stopAllSenders(): Promise<number> {
  let stopped = 0;
  const entries = Array.from(sessions.entries());
  for (const [sessionId, s] of entries) {
    if (s.isActive) {
      s.shouldStop = true;
      await storage.setUserWantsActive(sessionId, false);
      stopped++;
    }
  }
  return stopped;
}

export async function restoreAllSessions() {
  const settings = await storage.getSiteSettings();
  const activeConfigs = await storage.getAllActiveConfigs();
  const allApproved = await storage.getAllApprovedUsers();
  const approvedSessionIds = new Set(allApproved.map(u => u.sessionId));

  for (const config of activeConfigs) {
    if (!config.userWantsActive || !config.token || !config.message || !config.channelIds || !config.sessionId) {
      continue;
    }

    if (settings.isLocked && !approvedSessionIds.has(config.sessionId)) {
      await storage.setUserWantsActive(config.sessionId, false);
      await storage.updateConfigStatus(config.sessionId, false);
      await storage.deleteConfig(config.sessionId);
      continue;
    }

    const s = getSession(config.sessionId);
    s.totalSent = config.totalSent;
    emitLog(config.sessionId, "Previous active session detected - auto-resuming...", "success");
    await startSender(config.sessionId, config.token, config.message, config.channelIds, config.delay, true);
  }
}
