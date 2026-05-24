import type { NextFunction, Request, Response } from 'express';
import { clerkMiddleware, getAuth } from '@clerk/express';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { findOrCreateUserFromClerk } from '../services/user.service.js';
import type { UserDoc } from '../models/User.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

export const clerkAuth = clerkMiddleware({
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  secretKey: env.CLERK_SECRET_KEY,
});

// Garde: exige une session Clerk valide et charge le User local
export async function requireUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = getAuth(req);
    if (!userId) throw AppError.unauthorized();
    req.user = await findOrCreateUserFromClerk(userId);
    next();
  } catch (err) {
    next(err);
  }
}

// Charge req.user si le user est auth, sinon laisse passer sans rien faire
export async function attachUserIfAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = getAuth(req);
    if (userId) {
      req.user = await findOrCreateUserFromClerk(userId);
    }
    next();
  } catch (err) {
    next(err);
  }
}
