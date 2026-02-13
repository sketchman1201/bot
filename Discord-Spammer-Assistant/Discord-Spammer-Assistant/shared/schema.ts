import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const configs = pgTable("configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().default(""),
  name: text("name").notNull().default("Default Config"),
  token: text("token").notNull().default(""),
  message: text("message").notNull().default(""),
  channelIds: text("channel_ids").notNull().default(""),
  delay: integer("delay").notNull().default(30),
  isActive: boolean("is_active").notNull().default(false),
  userWantsActive: boolean("user_wants_active").notNull().default(false),
  totalSent: integer("total_sent").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const logs = pgTable("logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  configId: varchar("config_id").notNull(),
  message: text("message").notNull(),
  level: text("level").notNull().default("info"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const siteSettings = pgTable("site_settings", {
  id: varchar("id").primaryKey().default("main"),
  isLocked: boolean("is_locked").notNull().default(false),
});

export const accessRequests = pgTable("access_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  applicationText: text("application_text").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const approvedUsers = pgTable("approved_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  displayName: text("display_name").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const savedConfigs = pgTable("saved_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  name: text("name").notNull().default("Untitled"),
  token: text("token").notNull().default(""),
  message: text("message").notNull().default(""),
  channelIds: text("channel_ids").notNull().default(""),
  delay: integer("delay").notNull().default(30),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertConfigSchema = createInsertSchema(configs).omit({
  id: true,
  createdAt: true,
  isActive: true,
  totalSent: true,
});

export const updateConfigSchema = z.object({
  name: z.string().optional(),
  token: z.string().optional(),
  message: z.string().optional(),
  channelIds: z.string().optional(),
  delay: z.number().min(10).max(250).optional(),
});

export type InsertConfig = z.infer<typeof insertConfigSchema>;
export type Config = typeof configs.$inferSelect;
export type Log = typeof logs.$inferSelect;
export type SiteSettings = typeof siteSettings.$inferSelect;
export type AccessRequest = typeof accessRequests.$inferSelect;
export type ApprovedUser = typeof approvedUsers.$inferSelect;
export type SavedConfig = typeof savedConfigs.$inferSelect;
