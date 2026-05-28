import 'dotenv/config';
import { z } from 'zod';

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

  // URL publique de l'API (sans slash final). Utilisee par Better Auth comme
  // baseURL pour generer les URLs de callback OAuth.
  // staging -> https://api-staging.buvard.app, prod -> https://api.buvard.app.
  PUBLIC_API_URL: z.url(),

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
