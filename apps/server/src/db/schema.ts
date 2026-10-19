import { sql } from "drizzle-orm";
import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "operator"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("operator"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`)],
);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the session token; the token itself is only held by the client. */
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Instance-wide key/value settings (instance identity, licence lease, …). */
export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const printerGroups = pgTable(
  "printer_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("printer_groups_name_lower_idx").on(sql`lower(${table.name})`)],
);

export const printers = pgTable("printers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  driver: text("driver").notNull().default("moonraker"),
  url: text("url").notNull(),
  /** AES-256-GCM encrypted with the instance secret (see src/crypto.ts). */
  apiKeyEncrypted: text("api_key_encrypted"),
  groupId: uuid("group_id").references(() => printerGroups.id, { onDelete: "set null" }),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
