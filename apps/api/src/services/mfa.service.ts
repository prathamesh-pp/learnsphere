import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { UserCredentialModel } from "../models/user-credential.model.js";
import { sha256 } from "./session.service.js";

export function encryptTotpSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptTotpSecret(value: string, key: Buffer): string {
  const [version, ivText, tagText, dataText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !dataText) throw new Error("Invalid encrypted MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let encoded = "";
  for (let i = 0; i < bits.length; i += 5) encoded += alphabet[Number.parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return encoded;
}

function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/, "")) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid TOTP secret");
    bits += digit.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function createTotp(secret: string, time = Date.now()): string {
  const counter = Math.floor(time / 30000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binary.toString().padStart(6, "0");
}

export function validTotpStep(secret: string, code: string, time = Date.now()): number | undefined {
  for (const step of [-1, 0, 1]) {
    const expected = Buffer.from(createTotp(secret, time + step * 30000));
    const actual = Buffer.from(code);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return Math.floor(time / 30000) + step;
  }
  return undefined;
}

export function verifyTotp(secret: string, code: string, time = Date.now()): boolean {
  if (validTotpStep(secret, code, time) !== undefined) return true;
  return false;
}

export function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(8).toString("hex").toUpperCase());
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const codeHash = sha256(code.toUpperCase());
  const result = await UserCredentialModel.updateOne({ userId, mfaEnabled: true, recoveryCodeHashes: codeHash }, { $pull: { recoveryCodeHashes: codeHash } });
  return result.modifiedCount === 1;
}
