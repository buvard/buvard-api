import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';

// Refuse les comptes bannis ou en suspension active
export function requireActive(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(AppError.unauthorized());
    return;
  }
  if (req.user.status === 'banned') {
    next(AppError.forbidden('Compte banni'));
    return;
  }
  if (req.user.status === 'suspended') {
    const until = req.user.suspendedUntil;
    if (!until || until > new Date()) {
      next(AppError.forbidden('Compte suspendu'));
      return;
    }
  }
  next();
}
