import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "app_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60; // 8 ساعات

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET يجب أن يكون موجودًا وطوله 32 حرفًا على الأقل.",
    );
  }

  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

function readCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return undefined;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return undefined;
}

export function createSessionCookie(res: Response): void {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;

  const payload = String(expiresAt);
  const signature = sign(payload);
  const token = `${payload}.${signature}`;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_DURATION_SECONDS * 1000,
    path: "/api",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
  });
}

export function isValidSession(req: Request): boolean {
  try {
    const token = readCookie(req, COOKIE_NAME);

    if (!token) {
      return false;
    }

    const [expiresAtText, receivedSignature] = token.split(".");

    if (!expiresAtText || !receivedSignature) {
      return false;
    }

    const expiresAt = Number(expiresAtText);

    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return false;
    }

    const expectedSignature = sign(expiresAtText);

    return safeEqual(receivedSignature, expectedSignature);
  } catch {
    return false;
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isValidSession(req)) {
    res.status(401).json({ error: "يجب تسجيل الدخول أولًا." });
    return;
  }

  next();
}
