import { SignJWT, importPKCS8 } from 'jose';

// Genere le client secret JWT pour Sign in with Apple. Apple n'accepte pas un
// secret statique : c'est un JWT signe ES256 avec la cle privee .p8, valable au
// max 180 jours. Better Auth ne fournit pas de helper en 1.6.x -> on le genere.
//
// Claims imposes par Apple :
//   iss = Team ID, sub = Service ID (clientId), aud = https://appleid.apple.com
//   iat = maintenant, exp = iat + 180j, header { alg: ES256, kid: Key ID }
//
// Note : le JWT expirant a 180j, il faut le regenerer. Ici on le genere au boot
// du serveur (dans initAuth) ; un redeploy/restart < 180j suffit a le rafraichir.
export async function generateAppleClientSecret(params: {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}): Promise<string> {
  const key = await importPKCS8(params.privateKey, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  const SIX_MONTHS = 180 * 24 * 60 * 60;

  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: params.keyId })
    .setIssuer(params.teamId)
    .setSubject(params.clientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt(now)
    .setExpirationTime(now + SIX_MONTHS)
    .sign(key);
}
