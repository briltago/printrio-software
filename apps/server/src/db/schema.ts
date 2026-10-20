import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
  /** Spool loaded in the printer, assigned by hand. */
  activeSpoolId: uuid("active_spool_id").references((): AnyPgColumn => spools.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Previous versions of printer config files, written before every save from Printrio. */
export const configBackups = pgTable(
  "config_backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    printerId: uuid("printer_id")
      .notNull()
      .references(() => printers.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("config_backups_printer_path_idx").on(table.printerId, table.path, table.createdAt),
  ],
);

/** Filament products (vendor + material + colour); spools are physical rolls of one. */
export const filaments = pgTable("filaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendor: text("vendor"),
  name: text("name").notNull(),
  material: text("material").notNull(),
  colorName: text("color_name"),
  colorHex: text("color_hex"),
  diameter: doublePrecision("diameter").notNull().default(1.75),
  density: doublePrecision("density").notNull(),
  spoolWeight: doublePrecision("spool_weight"),
  emptySpoolWeight: doublePrecision("empty_spool_weight"),
  price: doublePrecision("price"),
  /** Source record for imports (e.g. "spoolman:http://host:7912#12"), to update instead of duplicate. */
  externalId: text("external_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spools = pgTable("spools", {
  id: uuid("id").primaryKey().defaultRandom(),
  filamentId: uuid("filament_id")
    .notNull()
    .references(() => filaments.id, { onDelete: "restrict" }),
  initialWeight: doublePrecision("initial_weight").notNull(),
  remainingWeight: doublePrecision("remaining_weight").notNull(),
  emptySpoolWeight: doublePrecision("empty_spool_weight"),
  price: doublePrecision("price"),
  location: text("location"),
  lot: text("lot"),
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
  externalId: text("external_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
