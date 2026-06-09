import { env } from '../config/env.js';

// Periode de grace (ms) entre la demande de suppression de compte (soft-delete,
// recuperable) et l'anonymisation definitive. Configuree via env.
export const GRACE_MS = env.ACCOUNT_PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000;

// Vrai si le delai de grace est ecoule depuis la demande de suppression.
// Au-dela, le compte ne peut plus etre recupere.
export function isGraceExpired(deletedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - deletedAt.getTime() >= GRACE_MS;
}
