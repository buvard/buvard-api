import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from '../config/auth.js';
import { AppError } from '../utils/AppError.js';
import { findOrCreateUserFromAuth } from '../services/user.service.js';
import type { UserDoc } from '../models/User.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

// Recupere la session Better Auth (cookie en web, Bearer en natif via le
// plugin capacitor). Retourne null si pas authentifie.
async function readSession(req: Request) {
  const auth = getAuth();
  return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}

// Garde: exige une session valide et charge le User local
export async function requireUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await readSession(req);
    if (!session?.user) throw AppError.unauthorized();
    req.user = await findOrCreateUserFromAuth({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    });
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
    const session = await readSession(req);
    if (session?.user) {
      req.user = await findOrCreateUserFromAuth({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}
