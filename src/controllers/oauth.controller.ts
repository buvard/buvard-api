import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { generateGoogleOAuthInitUrl, handleGoogleCallback } from '../services/oauth.service.js';

// Pont OAuth pour le retour des flux Clerk depuis le navigateur systeme vers
// l'app native (Capacitor). Clerk impose un redirect_url en https/http
// (cf. erreur invalid_url_schema sur les schemes custom), donc on ne peut pas
// lui donner directement `app.buvard.staging://oauth-callback`.
//
// Cette route renvoie une page HTML minimale qui rebondit (meta refresh + lien
// fallback) vers le scheme custom defini par APP_BUNDLE_ID. Le scheme est
// declare cote natif :
//   - Android : intent-filter VIEW/BROWSABLE sur ${applicationId}
//   - iOS    : CFBundleURLTypes avec $(PRODUCT_BUNDLE_IDENTIFIER)
// L'OS intercepte la navigation et rouvre l'app, ou l'AppUrlListener finalise
// la session Clerk avec le `__clerk_handshake` recu en query.
//
// On evite tout inline script pour rester compatible avec la CSP par defaut
// de helmet (script-src 'self'). Le meta refresh suffit pour declencher la
// navigation vers le scheme custom, et le lien sert de fallback manuel.
export function oauthBridge(req: Request, res: Response): void {
  const qIndex = req.url.indexOf('?');
  const query = qIndex >= 0 ? req.url.slice(qIndex) : '';
  const target = `${env.APP_BUNDLE_ID}://oauth-callback${query}`;
  const escaped = escapeHtml(target);

  res.type('html').send(
    `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${escaped}">
<title>Retour vers Buvard</title>
</head>
<body>
<p>Redirection vers l'app...</p>
<p>Si rien ne se passe : <a href="${escaped}">Ouvrir Buvard</a></p>
</body>
</html>`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Flow BFF Google OAuth (pour Capacitor en instance Clerk prod). cf. oauth.service.ts.
//
// Le front appelle /oauth/google/init pour recuperer une URL Google a ouvrir
// dans une Custom Tab. Google redirige vers /oauth/google/callback ci-dessous,
// qui finalise et renvoie un ticket Clerk via le deep link de l'app.

// GET /oauth/google/init -> { url } a ouvrir dans @capacitor/browser cote front
export async function oauthGoogleInit(_req: Request, res: Response): Promise<void> {
  const { url } = await generateGoogleOAuthInitUrl();
  res.json({ url });
}

// GET /oauth/google/callback?code=...&state=...
// Endpoint cible par Google apres consent. Echange le code, recupere/cree
// l'user Clerk, genere un sign-in ticket, et rebondit vers le scheme natif :
//   `<APP_BUNDLE_ID>://oauth-callback?ticket=<ticket>` (succes)
//   `<APP_BUNDLE_ID>://oauth-callback?error=<message>` (echec)
export async function oauthGoogleCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const errorParam = typeof req.query.error === 'string' ? req.query.error : undefined;

  // Google a renvoye une erreur (ex: user a cliqué "Annuler")
  if (errorParam) {
    return renderBridgePage(res, `error=${encodeURIComponent(errorParam)}`);
  }

  if (!code || !state) {
    throw AppError.badRequest('code et state requis');
  }

  try {
    const { ticket } = await handleGoogleCallback(code, state);
    return renderBridgePage(res, `ticket=${encodeURIComponent(ticket)}`);
  } catch (err) {
    // On rebondit quand meme vers l'app avec l'erreur, plutot que de laisser
    // l'user bloque dans la Custom Tab Chrome. Le front affichera un toast.
    const message = err instanceof Error ? err.message : 'erreur inconnue';
    return renderBridgePage(res, `error=${encodeURIComponent(message)}`);
  }
}

// Sert une page HTML qui rebondit vers `<APP_BUNDLE_ID>://oauth-callback?<query>`.
// Identique a oauthBridge ci-dessus mais sans la query d'origine (on construit ici).
function renderBridgePage(res: Response, query: string): void {
  const target = `${env.APP_BUNDLE_ID}://oauth-callback?${query}`;
  const escaped = escapeHtml(target);
  res.type('html').send(
    `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${escaped}">
<title>Retour vers Buvard</title>
</head>
<body>
<p>Redirection vers l'app...</p>
<p>Si rien ne se passe : <a href="${escaped}">Ouvrir Buvard</a></p>
</body>
</html>`,
  );
}
