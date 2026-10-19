import { loginRequestSchema, setupRequestSchema, type User } from "@printrio/shared";
import { count, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getDummyHash, hashPassword, verifyPassword } from "../auth/password.ts";
import { createSession, deleteSession, findSessionUser, SESSION_COOKIE } from "../auth/sessions.ts";
import type { Database } from "../db/client.ts";
import { users } from "../db/schema.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

interface AuthOptions {
  db: Database;
  cookieSecure: boolean;
}

export function authRoutes(app: FastifyInstance, { db, cookieSecure }: AuthOptions) {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? await findSessionUser(db, token) : null;
  });

  const setSessionCookie = (reply: FastifyReply, token: string, expires: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
      expires,
    });

  const userCount = async () => (await db.select({ value: count() }).from(users))[0]?.value ?? 0;

  app.get("/api/setup/status", async () => ({ setupRequired: (await userCount()) === 0 }));

  app.post("/api/setup", async (request, reply) => {
    const parsed = setupRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { email, displayName, password } = parsed.data;
    const passwordHash = await hashPassword(password);

    // Serialise concurrent setup attempts so only one initial admin can be created.
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('printrio_setup'))`);
      const [existing] = await tx.select({ value: count() }).from(users);
      if ((existing?.value ?? 0) > 0) return null;
      const [user] = await tx
        .insert(users)
        .values({ email, displayName, passwordHash, role: "admin" })
        .returning({ id: users.id });
      return user ?? null;
    });
    if (!created) return reply.code(409).send({ error: "Setup has already been completed." });

    const session = await createSession(db, created.id);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({ ok: true });
  });

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid email or password." });
      const { email, password } = parsed.data;

      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1);
      const valid = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
      if (!user || !valid) return reply.code(401).send({ error: "Invalid email or password." });

      const session = await createSession(db, user.id);
      setSessionCookie(reply, session.token, session.expiresAt);
      return { ok: true };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (request) => request.user);
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ error: "Authentication required." });
}
