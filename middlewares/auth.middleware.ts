import type { NextFunction, Request, Response } from "express";
import { Auth_Cookie, verifyAuthToken } from "../lib/auth";
import { AuthUser } from "../contract/user.contract";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[Auth_Cookie];
  if (typeof token !== "string" || token.length === 0) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    req.user = verifyAuthToken(token);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
