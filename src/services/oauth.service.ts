import { randomBytes } from 'node:crypto';
import { clerkClient } from '@clerk/express';
import { env } from '../config/env.js';
import { OAuthStateModel } from '../models/OAuthState.js';
import { AppError } from '../utils/AppError.js';

// Flow BFF (Backend-For-Frontend) pour Google OAuth.
//
// Pourquoi pas le flow Clerk natif ?
//   Les instances Clerk PROD (avec domaine custom) reposent sur des cookies
//   first-party de `clerk.buvard.app`. En Capacitor, l'OAuth voyage par une
//   Custom Tab Chrome — process Android separe de la WebView de l'app — qui
//   n'a pas ces cookies. Resultat : `authorization_invalid` au callback.
//   La doc Clerk recommande le pattern BFF pour les apps natives mobiles.
//
// Ici, le back joue intermediaire : il init l'OAuth lui-meme (Google API
// directement), recupere le code Google, l'echange contre un id_token,
// trouve/cree le user Clerk via l'API Backend, et genere un `sign_in_token`
// (un ticket usage unique) que le front utilise via signIn.create({ strategy: 'ticket' }).

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

interface GoogleIdTokenPayload {
  iss: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  picture?: string;
  [key: string]: unknown;
}

// Genere une URL Google OAuth + persiste le state pour validation au callback.
export async function generateGoogleOAuthInitUrl(): Promise<{ url: string }> {
  const state = randomBytes(32).toString('hex');
  await OAuthStateModel.create({ state });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.PUBLIC_API_URL}/oauth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // prompt=select_account : force l'affichage du selecteur, evite le SSO auto
    // quand l'user a deja un compte connecte dans Chrome
    prompt: 'select_account',
  });

  return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}` };
}

// Echange le code Google contre un id_token + access_token.
async function exchangeCodeForTokens(code: string): Promise<{ id_token: string }> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.PUBLIC_API_URL}/oauth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw AppError.unauthorized(`Echec echange token Google: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id_token?: string; access_token?: string };
  if (!data.id_token) {
    throw AppError.unauthorized('id_token Google manquant');
  }
  return { id_token: data.id_token };
}

// Decode le payload d'un JWT (sans verification de signature : Google nous l'a
// donne via une requete HTTPS authentifiee avec notre Client Secret, donc
// l'integrite est deja garantie par TLS + l'echange OAuth lui-meme).
function decodeIdToken(idToken: string): GoogleIdTokenPayload {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw AppError.badRequest('id_token Google malforme');
  const payload = parts[1];
  // base64url -> base64 standard
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  return JSON.parse(decoded) as GoogleIdTokenPayload;
}

// Trouve un user Clerk par email, ou le cree avec l'identite Google.
async function findOrCreateClerkUserFromGoogle(profile: GoogleIdTokenPayload): Promise<{ id: string }> {
  const email = profile.email;
  if (!email) throw AppError.unauthorized('Email Google manquant');
  if (profile.email_verified === false) throw AppError.unauthorized('Email Google non verifie');

  // Cherche un user existant via Clerk Backend API
  const list = await clerkClient.users.getUserList({ emailAddress: [email] });
  if (list.data.length > 0) {
    return { id: list.data[0].id };
  }

  // Cree un nouveau user. skipPasswordRequirement: true pour permettre la
  // creation sans mot de passe (l'auth se fera via ticket OAuth).
  const created = await clerkClient.users.createUser({
    emailAddress: [email],
    firstName: profile.given_name,
    lastName: profile.family_name,
    skipPasswordRequirement: true,
  });
  return { id: created.id };
}

// Genere un sign-in token Clerk pour ce user — c'est le ticket que le front
// consommera via signIn.create({ strategy: 'ticket', ticket }).
async function createSignInTicket(userId: string): Promise<string> {
  const token = await clerkClient.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 600,
  });
  return token.token;
}

// Pipeline complet : code Google -> ticket Clerk.
export async function handleGoogleCallback(code: string, state: string): Promise<{ ticket: string }> {
  // 1. Verifie + consomme le state (anti-CSRF + single-use)
  const stateDoc = await OAuthStateModel.findOneAndDelete({ state });
  if (!stateDoc) throw AppError.unauthorized('state OAuth invalide ou expire');

  // 2. Echange le code contre les tokens Google
  const { id_token } = await exchangeCodeForTokens(code);

  // 3. Decode l'id_token pour recuperer l'identite Google
  const profile = decodeIdToken(id_token);

  // 4. Trouve ou cree le user Clerk
  const clerkUser = await findOrCreateClerkUserFromGoogle(profile);

  // 5. Genere un ticket signIn pour le front
  const ticket = await createSignInTicket(clerkUser.id);

  return { ticket };
}
