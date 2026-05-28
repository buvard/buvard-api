import mongoose from 'mongoose';
import { betterAuth } from 'better-auth';
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
    trustedOrigins: env.CORS_ORIGINS,

    database: mongodbAdapter(db, { client }),

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    plugins: [capacitor()],
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
