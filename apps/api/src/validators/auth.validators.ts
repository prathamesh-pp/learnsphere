import { z } from "zod";

export const registrationSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(128),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(8).max(32).optional(),
}).strict().refine((value) => !(value.totpCode && value.recoveryCode), "Use one MFA method");

export const recoveryInitiationSchema = z.object({ email: z.string().trim().email().max(254) }).strict();
export const totpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
