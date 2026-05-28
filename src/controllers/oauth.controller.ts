import type { Request, Response } from 'express';
import { env } from '../config/env.js';

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
