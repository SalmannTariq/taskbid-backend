
import jwt from "jsonwebtoken";
import { CookieOptions, Response } from "express";
import { AuthUser } from "../contract/user.contract";

export const Auth_Cookie = "token";
const Days_MS = 7 * 24 * 60 * 60 * 1000;

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

function cookieOptions(): CookieOptions {
  return {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Days_MS,
  }
}

export function signAuthToken(user: AuthUser) {
  return jwt.sign({sub: user.id, email: user.email}, jwtSecret(), {expiresIn: Days_MS});
}

export function verifyAuthToken(token: string): AuthUser {
  const payload = jwt.verify(token, jwtSecret());
  if (typeof payload === "string") {
    throw new Error("Invalid token");
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0 || payload.email.length === 0 || typeof payload.email !== "string") {
    throw new Error("Invalid token");
  }
  return { id, email: payload.email};
}

export function setAuthCookie(res: Response, user: AuthUser) {
  res.cookie(Auth_Cookie, signAuthToken(user), cookieOptions());
}

export function clearAuthCookie(res: Response) {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  res.clearCookie(Auth_Cookie, options);
}