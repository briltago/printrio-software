import { z } from "zod";

/** Single sign-on with an OpenID Connect provider (Business). */
export const ssoSettingsInputSchema = z.object({
  enabled: z.boolean(),
  /** e.g. https://login.microsoftonline.com/<tenant>/v2.0, https://accounts.google.com */
  issuer: z.url("Enter the issuer URL of your identity provider.").max(500),
  clientId: z.string().trim().min(1, "Enter the client ID.").max(300),
  /** Empty keeps the stored secret. */
  clientSecret: z.string().max(1000).optional(),
  /** Text of the sign-in button, e.g. "Microsoft". */
  label: z.string().trim().min(1).max(40).default("SSO"),
  /** Only these e-mail domains may sign in (empty = any). */
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Invalid domain."),
    )
    .max(20)
    .default([]),
  /** Create an operator account on first sign-in. */
  autoCreate: z.boolean().default(false),
  /** Public address of Printrio when behind a proxy that hides it (for the redirect URI). */
  publicUrl: z.union([z.url(), z.literal("")]).optional(),
});
export type SsoSettingsInput = z.infer<typeof ssoSettingsInputSchema>;

export interface SsoSettingsDto {
  /** SSO needs a Business licence. */
  available: boolean;
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  label: string;
  allowedDomains: string[];
  autoCreate: boolean;
  publicUrl: string;
  /** Register this in the identity provider. */
  redirectUri: string;
}

/** What the sign-in page needs (public). */
export interface SsoPublicDto {
  enabled: boolean;
  label: string;
}
