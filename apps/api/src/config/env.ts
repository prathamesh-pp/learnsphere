import { z } from "zod";

const mongoUriSchema = z.string().trim().min(1).refine((value) => {
  try {
    const uri = new URL(value);
    return (uri.protocol === "mongodb:" || uri.protocol === "mongodb+srv:") && uri.hostname.length > 0;
  } catch {
    return false;
  }
}, "must be a valid MongoDB URI");

const webOriginSchema = z.string().trim().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}, "must be an HTTP or HTTPS origin without a path");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.string().regex(/^\d+$/, "must be a whole number").default("4000")
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535)),
  MONGODB_URI: mongoUriSchema,
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.string().regex(/^\d+$/, "must be a whole number").default("5000")
    .transform(Number)
    .pipe(z.number().int().min(100).max(120000)),
  WEB_ORIGIN: webOriginSchema.default("http://localhost:5173"),
  SESSION_IDLE_TIMEOUT_SECONDS: z.string().regex(/^\d+$/).default("1800").transform(Number).pipe(z.number().int().min(60).max(2592000)),
  SESSION_ABSOLUTE_TIMEOUT_SECONDS: z.string().regex(/^\d+$/).default("1209600").transform(Number).pipe(z.number().int().min(300).max(7776000)),
  PLATFORM_ADMIN_MFA_MAX_AGE_SECONDS: z.string().regex(/^\d+$/).default("43200").transform(Number).pipe(z.number().int().min(60).max(604800)),
  PLATFORM_ADMIN_SENSITIVE_MFA_MAX_AGE_SECONDS: z.string().regex(/^\d+$/).default("300").transform(Number).pipe(z.number().int().min(30).max(3600)),
  MFA_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9_-]{43,44}$/, "must be a base64url-encoded 32-byte key").refine((value) => {
    try { return Buffer.from(value, "base64url").length === 32; } catch { return false; }
  }, "must encode exactly 32 bytes"),
}).superRefine((config, context) => {
  if (config.NODE_ENV === "production" && !config.WEB_ORIGIN.startsWith("https://")) {
    context.addIssue({
      code: "custom",
      path: ["WEB_ORIGIN"],
      message: "must use HTTPS in production",
    });
  }
  if (config.SESSION_IDLE_TIMEOUT_SECONDS > config.SESSION_ABSOLUTE_TIMEOUT_SECONDS) {
    context.addIssue({ code: "custom", path: ["SESSION_IDLE_TIMEOUT_SECONDS"], message: "must not exceed absolute session timeout" });
  }
  if (config.PLATFORM_ADMIN_SENSITIVE_MFA_MAX_AGE_SECONDS > config.PLATFORM_ADMIN_MFA_MAX_AGE_SECONDS) {
    context.addIssue({ code: "custom", path: ["PLATFORM_ADMIN_SENSITIVE_MFA_MAX_AGE_SECONDS"], message: "must not exceed platform admin MFA max age" });
  }
});

export type AppConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  apiPort: number;
  mongoUri: string;
  mongoServerSelectionTimeoutMs: number;
  webOrigin: string;
  sessionIdleTimeoutSeconds: number;
  sessionAbsoluteTimeoutSeconds: number;
  platformAdminMfaMaxAgeSeconds: number;
  platformAdminSensitiveMfaMaxAgeSeconds: number;
  mfaEncryptionKey: Buffer;
}>;

export class ConfigurationError extends Error {
  constructor(fields: readonly string[]) {
    super(`Invalid API configuration: ${fields.join(", ")}`);
    this.name = "ConfigurationError";
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "environment"))];
    throw new ConfigurationError(fields);
  }

  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    apiPort: result.data.API_PORT,
    mongoUri: result.data.MONGODB_URI,
    mongoServerSelectionTimeoutMs: result.data.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    webOrigin: result.data.WEB_ORIGIN,
    sessionIdleTimeoutSeconds: result.data.SESSION_IDLE_TIMEOUT_SECONDS,
    sessionAbsoluteTimeoutSeconds: result.data.SESSION_ABSOLUTE_TIMEOUT_SECONDS,
    platformAdminMfaMaxAgeSeconds: result.data.PLATFORM_ADMIN_MFA_MAX_AGE_SECONDS,
    platformAdminSensitiveMfaMaxAgeSeconds: result.data.PLATFORM_ADMIN_SENSITIVE_MFA_MAX_AGE_SECONDS,
    mfaEncryptionKey: Buffer.from(result.data.MFA_ENCRYPTION_KEY, "base64url"),
  });
}
