import dotenv from 'dotenv';
import { z } from 'zod';

// Charge `.env.local` en priorite (overrides locaux, gitignored), puis `.env`
// en fallback. dotenv ne reecrit pas les vars deja set -> les valeurs de
// `.env.local` gagnent. Pattern equivalent a Vite cote front.
dotenv.config({ path: '.env.local' });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1, { error: 'MONGODB_URI requis' }),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // Secret Better Auth pour signer cookies / tokens de session.
  // Generer avec: openssl rand -hex 32
  BETTER_AUTH_SECRET: z.string().min(32, { error: 'BETTER_AUTH_SECRET doit faire 32+ chars' }),

  // OAuth Google (social provider Better Auth). Cree dans Google Cloud Console
  // (type "Web application"). Redirect URI a allowlister cote Google :
  //   <PUBLIC_API_URL>/api/auth/callback/google
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Sign in with Apple — OBLIGATOIRE App Store des qu'un autre login social
  // (Google) est propose (regle 4.8). Toutes optionnelles : si non remplies,
  // le provider Apple n'est pas active (utile en dev/staging tant que les
  // identifiants Apple Developer ne sont pas crees). Pour l'activer, les 5
  // doivent etre presentes.
  //   APPLE_CLIENT_ID            : Service ID (reverse-domain, ex. app.buvard.signin)
  //   APPLE_TEAM_ID              : Team ID (10 chars, Apple Developer Portal)
  //   APPLE_KEY_ID               : Key ID de la cle privee Sign in with Apple
  //   APPLE_PRIVATE_KEY          : contenu du .p8 (PEM, avec \n echappes)
  //   APPLE_APP_BUNDLE_ID        : bundle id de l'app iOS (flux natif idToken)
  APPLE_CLIENT_ID: z.string().min(1).optional(),
  APPLE_TEAM_ID: z.string().min(1).optional(),
  APPLE_KEY_ID: z.string().min(1).optional(),
  APPLE_PRIVATE_KEY: z
    .string()
    .min(1)
    .optional()
    // Les sauts de ligne d'une cle PEM sont souvent stockes echappes ("\n")
    // dans les variables d'env -> on les restaure.
    .transform((v) => (v ? v.replace(/\\n/g, '\n') : v)),
  APPLE_APP_BUNDLE_ID: z.string().min(1).optional(),

  // URL publique de l'API (sans slash final). Utilisee par Better Auth comme
  // baseURL pour generer les URLs de callback OAuth.
  // staging -> https://api-staging.buvard.app, prod -> https://api.buvard.app.
  PUBLIC_API_URL: z.url(),

  // Periode de grace (jours) entre la demande de suppression de compte
  // (soft-delete, recuperable) et l'anonymisation definitive (irreversible).
  // Standard industrie : 30j.
  ACCOUNT_PURGE_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Cloudflare R2 — stockage S3-compatible pour avatars / covers
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: z.url(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuration env invalide:', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
