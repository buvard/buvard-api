import type { Request } from 'express';
import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Rate limiting — protege l'API publique contre brute-force, spam de comptes
// et abus d'endpoints couteux. Store memoire (suffisant pour une instance
// unique ; passer a un store Redis si on scale horizontalement).

// Cle de limitation : on prefere l'id du user authentifie (req.user pose par
// requireUser) pour ne pas penaliser plusieurs users derriere une meme IP
// (NAT, wifi public). Fallback sur l'IP — via ipKeyGenerator qui normalise
// l'IPv6 en /64 pour eviter le contournement par rotation d'adresses dans un
// meme sous-reseau.
function keyByUserOrIp(req: Request): string {
  if (req.user) return `user:${req.user.id}`;
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

// Renvoie l'erreur 429 au format standard de l'API en deleguant a errorHandler,
// au lieu du body texte par defaut d'express-rate-limit.
const handler: Options['handler'] = (_req, _res, next) => {
  next(AppError.tooManyRequests());
};

// En environnement de test on neutralise le rate limiting (sinon les suites
// de tests qui tapent en boucle se font jeter). En dev on garde des limites
// larges pour ne pas se bloquer soi-meme.
const disabled = env.NODE_ENV === 'test';

function build(opts: Pick<Options, 'windowMs' | 'limit'>) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    handler,
    skip: () => disabled,
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Auth Better Auth (login, signup, reset) — la cible n°1 du brute-force.
// Strict et par IP uniquement (pas de req.user a ce stade).
export const authLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: env.NODE_ENV === 'development' ? 100 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `auth:${ipKeyGenerator(req.ip ?? '')}`,
  handler,
  skip: () => disabled,
});

// Filet global sur toute l'API metier — large, attrape juste les boucles folles.
export const apiLimiter = build({
  windowMs: MINUTE,
  limit: env.NODE_ENV === 'development' ? 1000 : 120,
});

// Uploads (avatar, cover, photos) — couteux (R2 + sharp).
export const uploadLimiter = build({
  windowMs: HOUR,
  limit: env.NODE_ENV === 'development' ? 200 : 30,
});

// Redemption de codes — empeche le bruteforce de codes valides.
export const redeemLimiter = build({
  windowMs: HOUR,
  limit: env.NODE_ENV === 'development' ? 100 : 5,
});

// Mutations sociales (follow, like, block) et creation de contenu — borne le
// spam tout en restant confortable pour un usage normal.
export const mutationLimiter = build({
  windowMs: MINUTE,
  limit: env.NODE_ENV === 'development' ? 1000 : 60,
});

// Export RGPD — operation rare et couteuse (agrege toutes les donnees du user).
// Tres strict pour eviter l'abus.
export const exportLimiter = build({
  windowMs: HOUR,
  limit: env.NODE_ENV === 'development' ? 100 : 3,
});
