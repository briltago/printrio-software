import type { FastifyReply, FastifyRequest } from "fastify";

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ error: "Authentication required." });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ error: "Authentication required." });
  if (request.user.role !== "admin")
    return reply.code(403).send({ error: "Only administrators can do this." });
}

/** Sends a 400 with the first Zod issue, or returns the parsed value. */
export function parseOr400<T>(
  reply: FastifyReply,
  result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } },
): T | undefined {
  if (result.success) return result.data;
  void reply.code(400).send({ error: result.error.issues[0]?.message ?? "Invalid request." });
  return undefined;
}
