import { randomBytes } from "node:crypto";
import {
  loginRequestSchema,
  type SsoPublicDto,
  setupRequestSchema,
  ssoSettingsInputSchema,
  type User,
} from "@printrio/shared";
import { count, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { findApiKeyUser } from "../auth/api-keys.ts";
import { getDummyHash, hashPassword, verifyPassword } from "../auth/password.ts";
import { createSession, deleteSession, findSessionUser, SESSION_COOKIE } from "../auth/sessions.ts";
import { type Sso, SsoError } from "../auth/sso.ts";
import type { Database } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { requireAdmin, requireUser } from "./guards.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

interface AuthOptions {
  db: Database;
  cookieSecure: boolean;
  /** OpenID Connect sign-in (Business). */
  sso?: Sso;
}

export function authRoutes(app: FastifyInstance, { db, cookieSecure, sso }: AuthOptions) {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? await findSessionUser(db, token) : null;
    // Integrations call module APIs (e.g. Business /v1) with a personal API key.
    // The core's own API stays session-only.
    if (!request.user && request.url.startsWith("/api/modules/")) {
      const match = /^Bearer\s+(prk_[\w-]+)$/.exec(request.headers.authorization ?? "");
      if (match?.[1]) request.user = await findApiKeyUser(db, match[1]);
    }
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
      // So the audit trail knows who signed in.
      request.user = await findSessionUser(db, session.token);
      return { ok: true };
    },
  );

  if (sso) ssoRoutes(app, db, sso, setSessionCookie);

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (request) => request.user);
}

/** OpenID Connect: public sign-in endpoints and the admin settings. */
const SSO_STATE_COOKIE = "printrio_sso_state";

function ssoRoutes(
  app: FastifyInstance,
  db: Database,
  sso: Sso,
  setSessionCookie: (reply: FastifyReply, token: string, expires: Date) => unknown,
) {
  const origin = (request: { protocol: string; host: string }) =>
    `${request.protocol}://${request.host}`;
  const failed = (reply: FastifyReply, message: string) =>
    reply.redirect(`/login?sso_error=${encodeURIComponent(message)}`);

  app.get("/api/auth/sso", async (): Promise<SsoPublicDto> => {
    const config = await sso.active();
    return { enabled: Boolean(config), label: config?.label ?? "SSO" };
  });

  app.get(
    "/api/auth/sso/start",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        const target = await sso.start(origin(request));
        // Bind the flow to this browser, so a callback link from someone else's flow is refused.
        reply.setCookie(SSO_STATE_COOKIE, new URL(target).searchParams.get("state") ?? "", {
          path: "/api/auth/sso",
          httpOnly: true,
          sameSite: "lax",
          secure: request.protocol === "https",
          maxAge: 600,
        });
        return reply.redirect(target);
      } catch (error) {
        return failed(reply, error instanceof SsoError ? error.message : "Single sign-on failed.");
      }
    },
  );

  app.get(
    "/api/auth/sso/callback",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };
      if (query.error)
        return failed(
          reply,
          query.error_description || "The identity provider refused the sign-in.",
        );
      if (!query.code || !query.state) return failed(reply, "The sign-in was not completed.");
      const expectedState = request.cookies[SSO_STATE_COOKIE];
      reply.clearCookie(SSO_STATE_COOKIE, { path: "/api/auth/sso" });
      if (!expectedState || expectedState !== query.state)
        return failed(reply, "The sign-in was started in another browser. Please try again.");
      try {
        const identity = await sso.finish(query.code, query.state);
        let [user] = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(sql`lower(${users.email}) = ${identity.email}`)
          .limit(1);
        // Administrators are only matched by an address the provider confirms (email_verified).
        if (user?.role === "admin" && !identity.emailVerified)
          return failed(
            reply,
            "Your identity provider does not confirm this e-mail address, so administrators sign in with their password.",
          );
        if (!user) {
          if (!identity.autoCreate)
            return failed(
              reply,
              `There is no Printrio account for ${identity.email}. Ask an admin to add you.`,
            );
          // A random password: this account signs in through the identity provider.
          const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
          [user] = await db
            .insert(users)
            .values({
              email: identity.email,
              displayName: identity.name,
              passwordHash,
              role: "operator",
            })
            .returning({ id: users.id, role: users.role });
        }
        if (!user) return failed(reply, "The account could not be created.");
        const session = await createSession(db, user.id);
        setSessionCookie(reply, session.token, session.expiresAt);
        request.user = await findSessionUser(db, session.token);
        return reply.redirect("/");
      } catch (error) {
        if (error instanceof SsoError) return failed(reply, error.message);
        throw error;
      }
    },
  );

  app.get("/api/settings/sso", { preHandler: requireAdmin }, async (request) =>
    sso.dto(await sso.config(), origin(request)),
  );

  app.put("/api/settings/sso", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ssoSettingsInputSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Invalid settings." });
    try {
      return sso.dto(await sso.save(parsed.data), origin(request));
    } catch (error) {
      if (error instanceof SsoError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });
}
