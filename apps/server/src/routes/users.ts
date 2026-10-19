import {
  createUserSchema,
  effectiveLimits,
  type UsersResponse,
  updateUserSchema,
} from "@printrio/shared";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword } from "../auth/password.ts";
import type { Database } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { parseOr400, requireAdmin } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });

export function userRoutes(app: FastifyInstance, db: Database) {
  // Licensing (F2) supplies a lease; until then the Free limits apply.
  const userLimit = () => effectiveLimits(null).users;
  const otherAdmins = async (id: string) =>
    (
      await db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, "admin"), ne(users.id, id)))
    )[0]?.value ?? 0;

  app.get("/api/users", { preHandler: requireAdmin }, async (): Promise<UsersResponse> => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt));
    return {
      users: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      limit: userLimit(),
    };
  });

  app.post("/api/users", { preHandler: requireAdmin }, async (request, reply) => {
    const input = parseOr400(reply, createUserSchema.safeParse(request.body));
    if (!input) return;
    const limit = userLimit();
    const [existing] = await db.select({ value: count() }).from(users);
    if (limit !== null && (existing?.value ?? 0) >= limit) {
      return reply
        .code(403)
        .send({ error: `Your plan includes up to ${limit} user accounts.`, code: "user_limit" });
    }
    const [duplicate] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${input.email})`);
    if (duplicate) return reply.code(409).send({ error: "A user with this email already exists." });
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      })
      .returning({ id: users.id });
    return reply.code(201).send(row);
  });

  app.patch("/api/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const input = params && parseOr400(reply, updateUserSchema.safeParse(request.body));
    if (!params || !input) return;
    if (input.role === "operator" && (await otherAdmins(params.id)) === 0) {
      return reply.code(409).send({ error: "There must be at least one administrator." });
    }
    const changes: Partial<typeof users.$inferInsert> = {};
    if (input.displayName) changes.displayName = input.displayName;
    if (input.role) changes.role = input.role;
    if (input.password) changes.passwordHash = await hashPassword(input.password);
    const [row] = await db
      .update(users)
      .set(changes)
      .where(eq(users.id, params.id))
      .returning({ id: users.id });
    if (!row) return reply.code(404).send({ error: "User not found." });
    // A password reset signs the user out everywhere.
    if (input.password && params.id !== request.user?.id)
      await db.delete(sessions).where(eq(sessions.userId, params.id));
    return { ok: true };
  });

  app.delete("/api/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    if (params.id === request.user?.id)
      return reply.code(409).send({ error: "You cannot delete your own account." });
    if ((await otherAdmins(params.id)) === 0)
      return reply.code(409).send({ error: "There must be at least one administrator." });
    const [row] = await db.delete(users).where(eq(users.id, params.id)).returning({ id: users.id });
    if (!row) return reply.code(404).send({ error: "User not found." });
    return { ok: true };
  });
}
