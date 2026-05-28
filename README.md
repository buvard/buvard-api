# buvard-api

API REST de l'app **Buvard** — back Express qui sert l'auth (Better Auth), les profils, les dégustations, les follows/blocks, et les bundles OTA Capgo.

> Consommée par le repo front **[`buvard-web`](../buvard-web)** (web + Capacitor iOS/Android).

## Stack

| Couche | Choix |
| --- | --- |
| Runtime | Node.js 22+ |
| Framework | Express 5 |
| Langage | TypeScript 6 (modules ESM, suffixe `.js` aux imports relatifs) |
| Base | MongoDB via Mongoose 8 |
| Auth | Better Auth (`better-auth` + `@better-auth/mongo-adapter` + `better-auth-capacitor`) |
| Validation | Zod 4 |
| Storage media | Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3` |
| Image | Sharp (resize → WebP) |
| Upload | Multer |
| Sécurité | Helmet, CORS, compression |
| Logs | Pino + pino-http |

## Démarrer

```bash
cp .env.example .env
# Renseigne au minimum :
#   MONGODB_URI                MongoDB local ou Atlas
#   BETTER_AUTH_SECRET         openssl rand -hex 32
#   GOOGLE_CLIENT_ID/SECRET    Google Cloud Console (Web Client ID)
#   PUBLIC_API_URL             URL publique de l'API (ex: http://localhost:4000)
#   R2_*                       Credentials Cloudflare R2
npm install
npm run dev
```

L'API tourne sur `http://localhost:4000`.

Vérif rapide :
```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/auth/get-session
```

## Architecture

```
src/
  app.ts                       # buildApp() — middlewares, mount du router, error handler
  server.ts                    # main() — connectDb → initAuth → buildApp → listen
  config/
    auth.ts                    # Better Auth (init paresseuse via initAuth/getAuth)
    db.ts                      # connexion Mongoose (dbName derive de NODE_ENV)
    env.ts                     # schema Zod des variables d'env
    logger.ts                  # Pino
    version.ts                 # APP_VERSION
  middlewares/
    auth.ts                    # requireUser / attachUserIfAuth (via Better Auth session)
    error.ts                   # error handler global (AppError, ZodError, Multer, Mongoose)
    notFound.ts                # 404
    requireActive.ts           # bloque les comptes suspended/banned
    requireRole.ts             # factory : requireRole('admin', 'moderator')
    upload.ts                  # multer (memory storage)
    validate.ts                # factory : validate(schema, source: body|query|params)
  models/
    User.ts                    # profil etendu (lie a l'user Better Auth via authUserId)
    Tasting.ts                 # degustation (alcool note + photo + commentaire)
    Follow.ts, Block.ts        # graph social
    Mention.ts                 # mentions @user dans bio/tasting
    AppRelease.ts              # bundles OTA Capgo
  controllers/                 # handlers Express (validation + appel service)
  services/                    # logique metier (Mongo, R2, sync Better Auth)
  routes/
    index.ts                   # apiRouter (mount /v1)
    v1/
      index.ts                 # users, tastings, app, admin
      user.route.ts            # /me, /me/prefs, /me/stats, /:username, follow/block
      tasting.route.ts         # CRUD + likes
      app.route.ts             # /latest-update (consomme par Capgo)
      admin/
        index.ts               # requireUser + requireActive + requireRole('admin')
        release.route.ts       # CRUD bundles OTA
  utils/AppError.ts            # classe d'erreur HTTP (badRequest, unauthorized, ...)
  views/landing.ts             # HTML landing page (servi sur GET /)
  zod/                         # schemas de validation par domaine
```

**Ordre de boot** *(important — Better Auth doit etre instancie apres Mongo)* :

1. `server.ts` → `await connectDb()` (Mongoose se connecte, `mongoose.connection.db` devient dispo)
2. `server.ts` → `initAuth()` (Better Auth lit `mongoose.connection.db` et instancie l'adapter)
3. `server.ts` → `buildApp()` (mount le handler `getAuth().handler` sur `/api/auth/*splat` AVANT `express.json()`)
4. `app.listen()`

## Authentification (Better Auth)

### Setup

- Library : `better-auth` + adapter Mongo natif (`@better-auth/mongo-adapter`) + plugin natif Capacitor (`better-auth-capacitor`).
- Routes auto-mountees sur `/api/auth/*` (sign-in, sign-up, sign-out, callback OAuth, get-session, etc.).
- Providers actifs : email/password + Google OAuth.
- Plugin `bearer()` activé : l'API accepte l'`Authorization: Bearer <session_token>` en plus des cookies (indispensable pour le natif Capacitor).
- Plugin `capacitor()` activé : enregistre `/api/auth/capacitor-authorization-proxy` et override l'origin pour les requetes natives.

### Collections Mongo créées par Better Auth

Better Auth gere ses propres collections (au pluriel pour Mongoose, **au singulier** ici puisque c'est Better Auth qui les nomme) :

| Collection | Rôle |
| --- | --- |
| `user` | Identité Better Auth (email, name, image, emailVerified) |
| `session` | Sessions actives (token, expiresAt, IP, UA) |
| `account` | OAuth providers liés (google, etc.) |
| `verification` | Tokens éphémères (email verify, reset password) |

### Mapping avec le User Mongoose

Notre `UserModel` (collection `users` au pluriel) est le **profil étendu** : username, displayName, prefs, stats, gamification, etc. Lié à l'user Better Auth via le champ `authUserId` (indexé unique).

Sync **paresseuse** : au premier appel API authentifié, `findOrCreateUserFromAuth({ id, email, name, image })` cherche/crée le doc Mongoose. Pas de webhook, pas de polling.

### Cookies cross-subdomain

`advanced.crossSubDomainCookies` est activé avec `domain: '.buvard.app'` → les cookies session sont posés sur le parent, accessibles depuis `buvard.app`, `staging.buvard.app`, `api.buvard.app`, `api-staging.buvard.app`.

### Pièges connus (à savoir avant de toucher l'auth)

1. **Plugin `bearer()` obligatoire** dans `plugins: [bearer(), capacitor()]` — sinon le natif Capacitor envoie son token Bearer mais le back l'ignore et cherche un cookie absent.
2. **`trustedOrigins` inclut les schemes natifs** (`app.buvard://`, `app.buvard.staging://`) en plus de `env.CORS_ORIGINS`. Sans ça, `signIn.social` rejette le callbackURL en `INVALID_CALLBACK_URL`.
3. **Init paresseuse** : si tu importes `auth` au top-level d'un module qui se charge avant `connectDb`, ça plante. Toujours via `getAuth()`.

## Endpoints API

### Better Auth — `/api/auth/*`

Géré par Better Auth, voir [doc officielle](https://www.better-auth.com/docs). Principaux :

- `POST /sign-in/email`, `POST /sign-up/email`
- `POST /sign-in/social` (body : `provider`, `callbackURL`)
- `GET /callback/google`
- `GET /get-session`, `POST /sign-out`
- `GET /capacitor-authorization-proxy?authorizationURL=...` (interne, plugin natif)

### App publique — `/api/v1/app/*`

| Méthode | Route | Auth | Rôle |
| --- | --- | --- | --- |
| `GET` | `/latest-update?platform=...&currentVersion=...` | public | Capgo OTA — renvoie le dernier bundle actif ou 204 |

### Users — `/api/v1/users/*`

| Méthode | Route | Auth | Rôle |
| --- | --- | --- | --- |
| `GET` | `/me` | session | Profil étendu courant |
| `PATCH` | `/me` | session + active | Update profil |
| `DELETE` | `/me` | session | Soft delete |
| `GET` | `/me/prefs` | session | Préférences |
| `PATCH` | `/me/prefs` | session | Update préférences |
| `GET` | `/me/stats` | session | Stats dénormalisées |
| `POST` | `/me/complete-onboarding` | session | Marque onboarding fini |
| `POST` | `/me/accept-terms` / `accept-privacy` | session | Acceptation légale |
| `GET` | `/me/blocks` | session | Liste des users bloqués |
| `GET` | `/me/mentions` | session | Mentions reçues |
| `POST` | `/me/avatar`, `/me/cover` | session + active | Upload image (multer + sharp + R2) |
| `DELETE` | `/me/avatar`, `/me/cover` | session | Supprime image |
| `GET` | `/:username` | optionnel | Profil public |
| `GET` | `/:username/followers`, `/following` | optionnel | Listes paginées |
| `POST` | `/:username/follow` | session | Suit un user |
| `DELETE` | `/:username/follow` | session | Unfollow |
| `POST` | `/:username/block` | session | Bloque un user |
| `DELETE` | `/:username/block` | session | Débloque |

### Tastings — `/api/v1/tastings/*`

| Méthode | Route | Auth | Rôle |
| --- | --- | --- | --- |
| `POST` | `/` | session | Crée une dégustation |
| `GET` | `/` | session | Liste les miennes (paginé) |
| `GET` | `/:id` | optionnel | Détail (respecte `privacy.profilePublic`) |
| `PATCH` | `/:id` | session | Update |
| `DELETE` | `/:id` | session | Soft delete |
| `POST` | `/:id/like`, `DELETE /:id/like` | session | Like / unlike |

### Admin — `/api/v1/admin/*`

Protégé par `requireUser + requireActive + requireRole('admin')`.

| Méthode | Route | Rôle |
| --- | --- | --- |
| `POST` | `/releases` | Upload bundle OTA (multipart : `file` + `version` + `platform` + `notes?`) |
| `GET` | `/releases` | Liste les releases |
| `PATCH` | `/releases/:id` | Active/désactive une release |
| `DELETE` | `/releases/:id` | Supprime release + objet R2 |

## Variables d'environnement

| Variable | Type | Rôle |
| --- | --- | --- |
| `NODE_ENV` | `development` / `production` / `test` | Détermine le nom de la base Mongo (`buvard-dev` / `buvard-prod` / `buvard-test`) |
| `PORT` | number | Default 4000 |
| `LOG_LEVEL` | `fatal`...`trace` | Default `info` |
| `MONGODB_URI` | URL | Sans nom de db (dérivé de `NODE_ENV`) |
| `CORS_ORIGINS` | CSV | Origines autorisées (cookies + trustedOrigins Better Auth). Inclure : `https://localhost`, `capacitor://localhost`, `http://localhost`, `http://localhost:5173`, et le domaine du front (`https://buvard.app` ou `https://staging.buvard.app`) |
| `BETTER_AUTH_SECRET` | string ≥ 32 chars | Secret pour signer cookies/tokens (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` | string | Web Client ID Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | string | Web Client Secret |
| `PUBLIC_API_URL` | URL | URL publique du back (sans slash final). Utilisé comme `baseURL` Better Auth et pour les redirect URI Google |
| `R2_ACCOUNT_ID` | string | Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | string | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | string | Cloudflare R2 |
| `R2_BUCKET` | string | Nom du bucket R2 |
| `R2_PUBLIC_URL` | URL | URL publique du bucket (`https://pub-xxx.r2.dev`) |

### Google Cloud Console

Pour que l'OAuth Google fonctionne, le Web Client ID doit avoir comme **Authorized redirect URI** :
- Staging : `https://api-staging.buvard.app/api/auth/callback/google`
- Prod : `https://api.buvard.app/api/auth/callback/google`

## Storage Cloudflare R2

Bucket utilisé pour :
- **Avatars** des users (`avatars/<userId>/<timestamp>.webp`) — uploadé via `POST /users/me/avatar`, traité par Sharp (400×400, WebP qualité 85).
- **Covers** des users (`covers/<userId>/<timestamp>.webp`) — 1500×500.
- **Bundles OTA** Capgo (`bundles/<platform>/<version>.zip`) — uploadé via l'admin.

Les fichiers sont **publics** (accessibles via `R2_PUBLIC_URL`), pas de présigné.

## OTA Capgo (self-hosted)

Le back sert les bundles JS aux apps Capacitor via :
- `GET /api/v1/app/latest-update?platform=android&currentVersion=x.y.z` : retourne `{ version, url, checksum, notes? }` si une release plus récente existe, 204 sinon.
- `POST /api/v1/admin/releases` : multipart upload du zip de `dist/` (frontend), calcule le SHA-256 côté serveur, push sur R2 + insère le doc Mongo.

Côté front, c'est le script `scripts/release.mjs` (dans `buvard-web`) qui appelle cet endpoint avec un `Authorization: Bearer <ADMIN_JWT>`. **L'admin JWT est un session token Better Auth d'un user `role: 'admin'`**.

## Scripts utiles

| Commande | Effet |
| --- | --- |
| `npm run dev` | tsx watch sur `src/server.ts` |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` |
| `npm start` | Lance `dist/server.js` |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |

## Déploiement

Le back tourne en prod sous PM2 :

```bash
# Sur le serveur
git pull
npm install                              # patch-package n'est pas utilise ici
npm run build
pm2 restart buvard-api-staging --update-env    # ou buvard-api en prod
```

**`--update-env` obligatoire** quand on modifie `.env` : sinon PM2 garde les vieilles vars en mémoire.

Sanity check post-deploy :
```bash
curl https://api-staging.buvard.app/health
curl https://api-staging.buvard.app/api/auth/get-session    # doit 200 + body null
```

## Pièges connus

1. **`bearer()` plugin Better Auth est obligatoire** — sans lui, le natif Capacitor n'arrive jamais à se logger même si le sign-in marche.
2. **L'init de Better Auth est paresseuse** : `server.ts` doit appeler `initAuth()` **après** `connectDb()` et **avant** `buildApp()`. Sinon `mongoose.connection.db` est `undefined`.
3. **Express 5 wildcard** : `app.all('/api/auth/*splat', ...)` (syntaxe nommée), `*` simple est rejeté.
4. **`toNodeHandler(auth.handler)` doit être monté AVANT `express.json()`** — Better Auth parse le body lui-même.
5. **`zod@4`** : si tu vois des warnings de peer-dep, vérifie que tu es bien sur zod 4 partout. La migration depuis zod 3 a été faite (formats extraits, `error` au lieu de `message`, `z.treeifyError` au lieu de `format()`).
6. **CORS_ORIGINS doit inclure `https://localhost`** (en plus de `http://localhost`) pour que la WebView Android `androidScheme: 'https'` puisse appeler l'API.
7. **`crossSubDomainCookies`** est activé en dur sur `.buvard.app`. Si tu déploies sous un autre domaine, à modifier dans `src/config/auth.ts`.

## À faire

- Réactiver `requireEmailVerification` si on veut forcer la vérification email avant login.
- Endpoint admin pour purger une session Better Auth de force.
- Webhook Better Auth `user.deleted` pour soft-delete le profil Mongoose en cascade.
- Ajouter une stratégie OAuth Apple pour iOS quand le store sera prêt.
