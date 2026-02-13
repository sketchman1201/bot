import { configs, logs, siteSettings, accessRequests, approvedUsers, savedConfigs, type Config, type InsertConfig, type Log, type SiteSettings, type AccessRequest, type ApprovedUser, type SavedConfig } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getConfig(sessionId: string): Promise<Config | undefined>;
  getAllConfigs(): Promise<Config[]>;
  getAllActiveConfigs(): Promise<Config[]>;
  upsertConfig(sessionId: string, config: Partial<InsertConfig>): Promise<Config>;
  updateConfigStatus(sessionId: string, isActive: boolean): Promise<void>;
  setUserWantsActive(sessionId: string, active: boolean): Promise<void>;
  incrementSent(sessionId: string): Promise<void>;
  addLog(configId: string, message: string, level: string): Promise<Log>;
  getLogs(configId: string, limit?: number): Promise<Log[]>;
  deleteLogsByConfigId(configId: string): Promise<void>;
  deleteConfig(sessionId: string): Promise<void>;
  getSiteSettings(): Promise<SiteSettings>;
  setSiteLocked(locked: boolean): Promise<SiteSettings>;
  createAccessRequest(sessionId: string, text: string): Promise<AccessRequest>;
  getAccessRequests(status?: string): Promise<AccessRequest[]>;
  getAccessRequestBySession(sessionId: string): Promise<AccessRequest | undefined>;
  updateAccessRequestStatus(id: string, status: string): Promise<void>;
  addApprovedUser(sessionId: string, displayName: string): Promise<ApprovedUser>;
  getApprovedUser(sessionId: string): Promise<ApprovedUser | undefined>;
  getAllApprovedUsers(): Promise<ApprovedUser[]>;
  updateApprovedUserName(id: string, displayName: string): Promise<void>;
  removeApprovedUser(id: string): Promise<void>;
  getSavedConfigs(sessionId: string): Promise<SavedConfig[]>;
  createSavedConfig(sessionId: string, data: { name: string; token: string; message: string; channelIds: string; delay: number }): Promise<SavedConfig>;
  deleteSavedConfig(id: string, sessionId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getConfig(sessionId: string): Promise<Config | undefined> {
    const [config] = await db.select().from(configs).where(eq(configs.sessionId, sessionId)).limit(1);
    return config;
  }

  async getAllConfigs(): Promise<Config[]> {
    return db.select().from(configs).orderBy(desc(configs.createdAt));
  }

  async getAllActiveConfigs(): Promise<Config[]> {
    return db.select().from(configs).where(eq(configs.userWantsActive, true));
  }

  async upsertConfig(sessionId: string, data: Partial<InsertConfig>): Promise<Config> {
    const existing = await this.getConfig(sessionId);
    if (existing) {
      const [updated] = await db
        .update(configs)
        .set(data)
        .where(eq(configs.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(configs)
      .values({
        sessionId,
        name: data.name || "Default Config",
        token: data.token || "",
        message: data.message || "",
        channelIds: data.channelIds || "",
        delay: data.delay || 30,
      })
      .returning();
    return created;
  }

  async updateConfigStatus(sessionId: string, isActive: boolean): Promise<void> {
    const existing = await this.getConfig(sessionId);
    if (existing) {
      await db.update(configs).set({ isActive }).where(eq(configs.id, existing.id));
    }
  }

  async setUserWantsActive(sessionId: string, active: boolean): Promise<void> {
    const existing = await this.getConfig(sessionId);
    if (existing) {
      await db.update(configs).set({ userWantsActive: active }).where(eq(configs.id, existing.id));
    }
  }

  async incrementSent(sessionId: string): Promise<void> {
    const existing = await this.getConfig(sessionId);
    if (existing) {
      await db.update(configs).set({ totalSent: existing.totalSent + 1 }).where(eq(configs.id, existing.id));
    }
  }

  async addLog(configId: string, message: string, level: string): Promise<Log> {
    const [log] = await db
      .insert(logs)
      .values({ configId, message, level })
      .returning();
    return log;
  }

  async getLogs(configId: string, limit: number = 50): Promise<Log[]> {
    return db
      .select()
      .from(logs)
      .where(eq(logs.configId, configId))
      .orderBy(desc(logs.createdAt))
      .limit(limit);
  }

  async deleteLogsByConfigId(configId: string): Promise<void> {
    await db.delete(logs).where(eq(logs.configId, configId));
  }

  async deleteConfig(sessionId: string): Promise<void> {
    const config = await this.getConfig(sessionId);
    if (config) {
      await this.deleteLogsByConfigId(config.id);
      await db.delete(configs).where(eq(configs.id, config.id));
    }
  }

  async getSiteSettings(): Promise<SiteSettings> {
    const [settings] = await db.select().from(siteSettings).where(eq(siteSettings.id, "main")).limit(1);
    if (settings) return settings;
    const [created] = await db.insert(siteSettings).values({ id: "main", isLocked: false }).returning();
    return created;
  }

  async setSiteLocked(locked: boolean): Promise<SiteSettings> {
    const existing = await this.getSiteSettings();
    const [updated] = await db.update(siteSettings).set({ isLocked: locked }).where(eq(siteSettings.id, "main")).returning();
    return updated;
  }

  async createAccessRequest(sessionId: string, text: string): Promise<AccessRequest> {
    const [req] = await db.insert(accessRequests).values({ sessionId, applicationText: text, status: "pending" }).returning();
    return req;
  }

  async getAccessRequests(status?: string): Promise<AccessRequest[]> {
    if (status) {
      return db.select().from(accessRequests).where(eq(accessRequests.status, status)).orderBy(desc(accessRequests.createdAt));
    }
    return db.select().from(accessRequests).orderBy(desc(accessRequests.createdAt));
  }

  async getAccessRequestBySession(sessionId: string): Promise<AccessRequest | undefined> {
    const [req] = await db.select().from(accessRequests).where(
      and(eq(accessRequests.sessionId, sessionId), eq(accessRequests.status, "pending"))
    ).limit(1);
    return req;
  }

  async updateAccessRequestStatus(id: string, status: string): Promise<void> {
    await db.update(accessRequests).set({ status }).where(eq(accessRequests.id, id));
  }

  async addApprovedUser(sessionId: string, displayName: string): Promise<ApprovedUser> {
    const existing = await this.getApprovedUser(sessionId);
    if (existing) {
      const [updated] = await db.update(approvedUsers).set({ displayName }).where(eq(approvedUsers.id, existing.id)).returning();
      return updated;
    }
    const [user] = await db.insert(approvedUsers).values({ sessionId, displayName }).returning();
    return user;
  }

  async getApprovedUser(sessionId: string): Promise<ApprovedUser | undefined> {
    const [user] = await db.select().from(approvedUsers).where(eq(approvedUsers.sessionId, sessionId)).limit(1);
    return user;
  }

  async getAllApprovedUsers(): Promise<ApprovedUser[]> {
    return db.select().from(approvedUsers).orderBy(desc(approvedUsers.createdAt));
  }

  async updateApprovedUserName(id: string, displayName: string): Promise<void> {
    await db.update(approvedUsers).set({ displayName }).where(eq(approvedUsers.id, id));
  }

  async removeApprovedUser(id: string): Promise<void> {
    const [user] = await db.select().from(approvedUsers).where(eq(approvedUsers.id, id)).limit(1);
    if (user) {
      await this.deleteConfig(user.sessionId);
      await db.delete(approvedUsers).where(eq(approvedUsers.id, id));
      await db.delete(accessRequests).where(eq(accessRequests.sessionId, user.sessionId));
    }
  }
  async getSavedConfigs(sessionId: string): Promise<SavedConfig[]> {
    return db.select().from(savedConfigs).where(eq(savedConfigs.sessionId, sessionId)).orderBy(desc(savedConfigs.createdAt));
  }

  async createSavedConfig(sessionId: string, data: { name: string; token: string; message: string; channelIds: string; delay: number }): Promise<SavedConfig> {
    const [saved] = await db.insert(savedConfigs).values({
      sessionId,
      name: data.name,
      token: data.token,
      message: data.message,
      channelIds: data.channelIds,
      delay: data.delay,
    }).returning();
    return saved;
  }

  async deleteSavedConfig(id: string, sessionId: string): Promise<void> {
    await db.delete(savedConfigs).where(and(eq(savedConfigs.id, id), eq(savedConfigs.sessionId, sessionId)));
  }
}

export const storage = new DatabaseStorage();
