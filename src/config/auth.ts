import mongoose from 'mongoose';
import { betterAuth } from 'better-auth';
import { bearer, twoFactor } from 'better-auth/plugins';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { capacitor } from 'better-auth-capacitor';
import { env } from './env.js';
import { logger } from './logger.js';
import { generateAppleClientSecret } from './appleSecret.js';

// Construit la config des providers sociaux. Google est toujours actif ; Apple
// n'est ajoute que si les identifiants Apple sont presents dans l'env (sinon on
// ne bloque pas le boot — utile tant que le compte Apple Developer n'est pas
// configure). Apple est OBLIGATOIRE pour l'App Store des que Google est propose.
async function buildSocialProviders() {
  const providers: Record<string, unknown> = {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  };

  const appleReady =
    env.APPLE_CLIENT_ID &&
    env.APPLE_TEAM_ID &&
    env.APPLE_KEY_ID &&
    env.APPLE_PRIVATE_KEY;

  if (appleReady) {
    providers.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: await generateAppleClientSecret({
        clientId: env.APPLE_CLIENT_ID!,
        teamId: env.APPLE_TEAM_ID!,
        keyId: env.APPLE_KEY_ID!,
        privateKey: env.APPLE_PRIVATE_KEY!,
      }),
      // Necessaire pour le flux natif iOS (idToken) : Apple utilise le bundle
      // id comme audience, pas le Service ID. Sans ca -> "Invalid id token".
      ...(env.APPLE_APP_BUNDLE_ID ? { appBundleIdentifier: env.APPLE_APP_BUNDLE_ID } : {}),
    };
    logger.info('Sign in with Apple active');
  } else {
    logger.warn('Sign in with Apple inactif (identifiants Apple absents) — requis pour l App Store');
  }

  return providers;
}

// Better Auth — instance initialisee paresseusement apres la connexion mongo.
// On ne peut pas instancier au top-level du module car `mongoose.connection.db`
// n'est dispo qu'une fois `connectDb()` resolu (dans server.ts).
//
// Le flux :
//   1. server.ts -> connectDb()
//   2. server.ts -> initAuth() (cree l'instance Better Auth)
//   3. buildApp() -> getAuth() (utilise l'instance dans le handler /api/auth/*)

let _auth: Awaited<ReturnType<typeof createAuth>> | null = null;

async function createAuth() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('mongo non connecte: appelle connectDb() avant initAuth()');
  }
  const client = mongoose.connection.getClient();

  return betterAuth({
    baseURL: env.PUBLIC_API_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [
      ...env.CORS_ORIGINS,
      'app.buvard://',
      'app.buvard.staging://',
      'app.buvard.local://',
      // Requis pour Sign in with Apple (communication avec les serveurs Apple).
      'https://appleid.apple.com',
    ],

    database: mongodbAdapter(db, { client }),

    // Schemes deep link des apps natives Capacitor — autorise les callbackURL
    // OAuth de la forme `app.buvard[.staging|.local]://...` que le plugin
    // capacitorClient genere automatiquement pour le retour OAuth en natif.
    // Sans ca, Better Auth rejette avec INVALID_CALLBACK_URL au moment du
    // POST /sign-in/social. (Le meme serveur peut servir plusieurs envs, donc
    // on liste les 3 schemes.)

    // Auth social-only (Apple + Google). email/password desactive : pas de MDP
    // a gerer cote serveur (donc pas de reset password ni de verification email
    // a implementer, pas de service mail). Les users s'authentifient uniquement
    // via leur provider. Reactiver ici si on veut reintroduire l'email/password
    // (impliquerait alors de cabler sendResetPassword).
    emailAndPassword: {
      enabled: false,
    },

    socialProviders: await buildSocialProviders(),

    plugins: [
      // `bearer()` autorise l'auth via Authorization Bearer (header) au lieu
      // de cookies. Indispensable pour le natif Capacitor : la WebView ne peut
      // pas envoyer les cookies cross-origin du domaine API, donc le plugin
      // capacitor() cote front passe le session_token en Bearer.
      bearer(),
      capacitor(),
      // 2FA (TOTP + OTP). Optionnel pour les users, mais on l'exige pour les
      // comptes admin via le middleware requireRole cote routes admin (les
      // comptes a privileges sont sensibles). Le plugin cree les endpoints
      // /two-factor/* et les tables associees.
      twoFactor(),
    ],

    advanced: {
      // Cookies poses sur le parent `.buvard.app` -> partages entre tous les
      // sous-domaines (`buvard.app`, `api.buvard.app`, `staging.buvard.app`,
      // `api-staging.buvard.app`). Necessaire pour que le web (front sur
      // buvard.app / staging.buvard.app) puisse lire le session cookie pose
      // par l'API. Sans ca, cross-subdomain = cross-site -> SameSite=Lax bloque.
      // Note : pas d'impact sur le natif (qui passe par Bearer via le plugin).
      crossSubDomainCookies: {
        enabled: true,
        domain: '.buvard.app',
      },
    },
  });
}

// Initialise l'instance Better Auth — appeler une fois apres connectDb().
// Async car la generation du client secret Apple (JWT ES256) est asynchrone.
export async function initAuth(): Promise<void> {
  if (_auth) return;
  _auth = await createAuth();
}

// Recupere l'instance Better Auth, throw si pas encore initialisee
export function getAuth() {
  if (!_auth) {
    throw new Error('Better Auth non initialise: appelle initAuth() apres connectDb()');
  }
  return _auth;
}

// Type de l'instance auth, expose pour annoter les middlewares
export type Auth = Awaited<ReturnType<typeof createAuth>>;
