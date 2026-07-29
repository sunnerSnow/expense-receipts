import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * HMAC 簽章的 session token(無狀態,不需 DB 存 session)。
 * 格式:base64url(payload) + "." + base64url(hmac(payload)),payload = "userId.簽發毫秒"。
 *
 * 這是自用規模的最小可用認證;正式加固方向見 docs/roadmap.md(Phase 1 auth 註記)。
 */

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function signSession(userId: string, nowMs: number = Date.now()): string {
  const payload = `${userId}.${nowMs}`;
  return `${b64url(payload)}.${hmac(payload)}`;
}

/** 驗證 token,回傳 userId;簽章不符或過期回傳 null */
export function verifySession(token: string, nowMs: number = Date.now()): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = hmac(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const userId = payload.slice(0, sep);
  const issuedAt = Number(payload.slice(sep + 1));
  if (!Number.isFinite(issuedAt) || nowMs - issuedAt > MAX_AGE_MS) return null;

  return userId;
}
