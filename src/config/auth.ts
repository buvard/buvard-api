import mongoose from 'mongoose';
import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { capacitor } from 'better-auth-capacitor';
import { env } from './env.js';

// Better Auth — instance initialisee paresseusement apres la connexion mongo.
// On ne peut pas instancier au top-level du module car `mongoose.connection.db`
// n'est dispo qu'une fois `connectDb()` resolu (dans server.ts).
//
// Le flux :
//   1. server.ts -> connectDb()
//   2. server.ts -> initAuth() (cree l'instance Better Auth)
//   3. buildApp() -> getAuth() (utilise l'instance dans le handler /api/auth/*)

let _auth: ReturnType<typeof createAuth> | null = null;

function createAuth() {
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
    ],

    database: mongodbAdapter(db, { client }),

    // Schemes deep link des apps natives Capacitor — autorise les callbackURL
    // OAuth de la forme `app.buvard[.staging]://...` que le plugin capacitorClient
    // genere automatiquement pour le retour OAuth en natif. Sans ca, Better Auth
    // rejette avec INVALID_CALLBACK_URL au moment du POST /sign-in/social.
    // (Le meme serveur sert les 2 envs si jamais, donc on liste les 2 schemes.)

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    plugins: [
      // `bearer()` autorise l'auth via Authorization Bearer (header) au lieu
      // de cookies. Indispensable pour le natif Capacitor : la WebView ne peut
      // pas envoyer les cookies cross-origin du domaine API, donc le plugin
      // capacitor() cote front passe le session_token en Bearer.
      bearer(),
      capacitor(),
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

// Initialise l'instance Better Auth — appeler une fois apres connectDb()
export function initAuth(): void {
  if (_auth) return;
  _auth = createAuth();
}

// Recupere l'instance Better Auth, throw si pas encore initialisee
export function getAuth() {
  if (!_auth) {
    throw new Error('Better Auth non initialise: appelle initAuth() apres connectDb()');
  }
  return _auth;
}

// Type de l'instance auth, expose pour annoter les middlewares
export type Auth = ReturnType<typeof createAuth>;
