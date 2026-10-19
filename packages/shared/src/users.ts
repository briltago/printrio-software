import { z } from "zod";
import { passwordSchema, userRoleSchema } from "./auth.ts";

export const createUserSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(120),
  password: passwordSchema,
  role: userRoleSchema,
});
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  role: userRoleSchema.optional(),
  password: passwordSchema.optional(),
});
export type UpdateUser = z.infer<typeof updateUserSchema>;

export const usersResponseSchema = z.object({
  users: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      displayName: z.string(),
      role: userRoleSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
  limit: z.number().int().nullable(),
});
export type UsersResponse = z.infer<typeof usersResponseSchema>;
