import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { isAdult, MIN_AGE } from '../utils/age.js';

// Age gate — 2e barriere (la 1ere etant la completion d'onboarding). A poser
// sur les routes contributives (creation/upload de contenu) en defense en
// profondeur, au cas ou un client atteindrait ces routes sans birthDate
// (compte legacy cree avant l'age gate, ou onboarding contourne).
//
// Deux codes distincts pour piloter l'UX front :
//   - AGE_REQUIRED : pas de date de naissance -> afficher l'ecran de saisie
//   - UNDERAGE     : date presente mais < MIN_AGE -> refus
//
// A monter APRES requireUser (depend de req.user).
export function requireAdult(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(AppError.unauthorized());
    return;
  }
  const { birthDate } = req.user;
  if (!birthDate) {
    next(AppError.ageRequired());
    return;
  }
  if (!isAdult(birthDate)) {
    next(AppError.underage(`Reserve aux ${MIN_AGE} ans et plus`));
    return;
  }
  next();
}
