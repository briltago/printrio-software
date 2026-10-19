import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "operator"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(256, "Password is too long.");

export const setupRequestSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(120),
  password: passwordSchema,
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: userRoleSchema,
});
export type User = z.infer<typeof userSchema>;

export const setupStatusSchema = z.object({
  setupRequired: z.boolean(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;
