import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import type { UserRole } from '../models/User.js';

// Factory: requireRole('admin', 'moderator') -> middleware Express
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(AppError.forbidden('Privileges insuffisants'));
      return;
    }
    next();
  };
}
