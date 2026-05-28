import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI requis'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),

  // Bundle identifier de l'app native correspondant a cet environnement.
  // Utilise par /oauth-bridge pour rebondir vers le scheme custom apres OAuth.
  // staging -> app.buvard.staging, prod -> app.buvard.
  APP_BUNDLE_ID: z.string().min(1).default('app.buvard.staging'),

  // OAuth Google (flow BFF natif). Meme Client ID / Secret que celui configure
  // cote Clerk dashboard SSO connections Google. Cree dans Google Cloud Console
  // (type "Web application"). Redirect URI a y allowlister : <PUBLIC_API_URL>/oauth/google/callback
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // URL publique de l'API (sans slash final). Utilisee comme redirect_uri Google.
  // staging -> https://api-staging.buvard.app, prod -> https://api.buvard.app.
  PUBLIC_API_URL: z.string().url(),

  // Cloudflare R2 — stockage S3-compatible pour avatars / covers
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: z.string().url(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuration env invalide:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
