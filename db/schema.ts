import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const studios = sqliteTable("studios", {
  owner: text("owner").primaryKey(),
  version: integer("version").notNull().default(0),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const offers = sqliteTable("offers", {
  token: text("token").primaryKey(),
  owner: text("owner").notNull(),
  planId: text("plan_id").notNull(),
  expiresAt: text("expires_at").notNull(),
});
export const aiUsage = sqliteTable("ai_usage", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull(),
});
