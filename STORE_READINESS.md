# Buvard API — Feuille de route mise en prod & conformité stores

> État au 2026-06-08. Audit complet de `src/` (54 fichiers).
> Base saine : architecture layered cohérente, validation Zod ~95%, authz hiérarchique,
> uploads sécurisés (MIME + taille + sharp), logs redactés, indexes Mongo pertinents,
> graceful shutdown. **Ce qui suit n'est PAS du refacto : ce sont les trous qui bloquent
> objectivement une publication Apple / Google Play.**

## Légende criticité

- 🔴 **BLOQUANT** — rejet store garanti OU faille exploitable dès l'ouverture publique
- 🟡 **IMPORTANT** — obligation légale (UE/RGPD), à faire avant le launch
- 🟢 **MINEUR** — cohérence/maintenabilité, à faire en dernier, ne bloque rien

---

## Ordre de bataille recommandé

`1. Rate limiting` → `2. Report` → `3. Age gate` → `4. Suppression (anonymisation)` → `5. Export RGPD` → `6. Refacto cosmétique`

Raison : on traite d'abord ce qui est isolé et sans risque métier (rate limiting), puis les
nouveaux modules de conformité (report, age gate), puis les modifs touchant plusieurs models
(anonymisation, export). Le refacto cosmétique en dernier — inutile de polir du code qu'on va
modifier.

---

## ✅ 1. Rate limiting — FAIT (2026-06-08)

**Problème :** aucun rate limiting. `/api/auth/*` était à nu → brute-force login, création
de comptes en masse, spam d'uploads, abus des agrégations coûteuses (`/tastings/discover/places`).

**Fait :**
- [x] Dépendance `express-rate-limit@^8.5.2`
- [x] `src/middlewares/rateLimit.ts` avec 5 limiteurs (clé user authentifié sinon IP, IPv6-safe via `ipKeyGenerator`) :
  - `authLimiter` : 10 req / 15 min / IP (prod) → monté sur `/api/auth/*` AVANT le handler Better Auth ([app.ts](src/app.ts))
  - `apiLimiter` : 120 req / min (prod) → global sur `/api`
  - `uploadLimiter` : 30 req / h → avatar / cover / photos tasting
  - `redeemLimiter` : 5 req / h → redeem-code
  - `mutationLimiter` : 60 req / min → follow / block / création tasting / like
- [x] `trust proxy` déjà setté → keyGenerator IP OK derrière le reverse proxy
- [x] Format d'erreur standard `{ error: { code, message } }` (handler délègue à `errorHandler`) + `AppError.tooManyRequests()`
- [x] Désactivé en `test`, limites larges en `development`

**Limite assumée :** store mémoire (OK mono-instance). Passer à un store Redis si scale horizontal.

**Fichiers touchés :** `package.json`, `src/middlewares/rateLimit.ts` (nouveau), `src/utils/AppError.ts`, `src/app.ts`, `src/routes/v1/user.route.ts`, `src/routes/v1/tasting.route.ts`

---

## ✅ 2. Signalement de contenu (report) — FAIT (2026-06-08)

**Problème :** contenu UGC (tastings, photos, bio) sans aucun moyen de signaler.
Exigence Apple n°1 sur l'UGC (Guideline 1.2). Le champ `reportsReceivedCount`
([User.ts:139](src/models/User.ts#L139)) existait mais n'était jamais incrémenté.

**Fait :**
- [x] Model [src/models/Report.ts](src/models/Report.ts) :
  - `reporterId`, `targetType` ('tasting' | 'user'), `targetId` (ObjectId polymorphe),
    `reason` (spam, harassment, inappropriate, underage, impersonation, other), `note`,
    `status` ('pending' | 'reviewed' | 'actioned' | 'dismissed'), `reviewedBy`, `reviewedAt`, `resolutionNote`
  - Index unique `(reporterId, targetType, targetId)` → anti-spam de reports
  - Index `(status, createdAt)` → file admin, + `(targetType, targetId)`
  - `toJSON` transform `_id`→`id` (cohérent avec les autres models)
- [x] [src/zod/report.zod.ts](src/zod/report.zod.ts) : create (reason+note), query admin (status/page/limit), resolve (status résolvable + note)
- [x] [src/services/report.service.ts](src/services/report.service.ts) :
  - `createReport()` — idempotent (renvoie `alreadyReported`), résout+vérifie la cible, **incrémente `reportsReceivedCount` sur le propriétaire** (user ou auteur du tasting)
  - `listReports()` — paginé, filtrable par statut, populate reporter
  - `resolveReport()` — change le statut + trace modérateur/date
- [x] Controllers : [report.controller.ts](src/controllers/report.controller.ts) (user) + [admin/report.controller.ts](src/controllers/admin/report.controller.ts)
- [x] Routes :
  - `POST /api/v1/tastings/:id/report` (requireUser + requireActive + mutationLimiter)
  - `POST /api/v1/users/:username/report` (idem)
  - `GET /api/v1/admin/reports` + `PATCH /api/v1/admin/reports/:id` (chain admin)
- [x] Auto-signalement bloqué (400 si on cible son propre profil/contenu)

**Reste à brancher (hors périmètre report, à faire avec l'admin) :** la *sanction* (ban user /
masquage tasting) depuis `resolveReport` est encore manuelle — `status: 'actioned'` trace la
décision mais n'applique pas l'action. À câbler sur les endpoints admin de modération une fois
qu'ils existeront (ex: suspension user). Suffisant pour la validation store en l'état.

**Note conformité :** report + block (déjà là) + engagement à agir sous 24h dans les métadonnées
store = suffisant pour Apple. Pas besoin de queue ML.

**Fichiers touchés :** `src/models/Report.ts`, `src/zod/report.zod.ts`, `src/services/report.service.ts`, `src/controllers/report.controller.ts`, `src/controllers/admin/report.controller.ts`, `src/routes/v1/admin/report.route.ts` (nouveaux), `src/routes/v1/admin/index.ts`, `src/routes/v1/tasting.route.ts`, `src/routes/v1/user.route.ts`

---

## ✅ 3. Age gate (18+) — FAIT (2026-06-08)

**Problème :** app d'alcool. `birthYear` (année seule) existait mais **optionnel et jamais
vérifié** — un mineur pouvait tout faire. Apple (1.4.3) et Google exigent une vérification
d'âge effective.

**Stratégie retenue :** `birthDate` (date complète, calcul exact au jour près) + saisie forcée
au prochain accès pour les comptes existants. Barrière à 2 niveaux.

**Fait :**
- [x] [src/utils/age.ts](src/utils/age.ts) : `MIN_AGE=18`, `ageFromBirthDate()` (exact jour/mois/an), `isAdult()`. Testé sur les cas limites (anniversaire pile aujourd'hui, 29 fév, fin d'année) → tous OK.
- [x] [src/models/User.ts](src/models/User.ts) : nouveau champ `birthDate` (Date). `birthYear` conservé (legacy/lecture, dérivé de birthDate).
- [x] Zod [user.zod.ts](src/zod/user.zod.ts) : `birthDateSchema` (borne 1900↔aujourd'hui + refuse si < 18). `completeOnboardingSchema` (exige birthDate). `PATCH /me` accepte `birthDate` (plus `birthYear`).
- [x] **Barrière 1 — onboarding** : `completeOnboarding(user, birthDate)` exige une date majeure. Impossible de compléter l'onboarding sans âge valide.
- [x] **Barrière 2 — middleware** [src/middlewares/requireAdult.ts](src/middlewares/requireAdult.ts) : défense en profondeur sur les routes contributives.
- [x] `requireAdult` appliqué sur `POST /tastings` et `POST /tastings/:id/photos` (création de contenu alcool). Au passage, `requireActive` ajouté à `POST /tastings` (il manquait).
- [x] Re-validation serveur dans `setBirthDate` (ceinture+bretelles, même si Zod valide déjà).
- [x] Codes d'erreur dédiés [AppError.ts](src/utils/AppError.ts) : `AGE_REQUIRED` (date absente → front affiche l'écran de saisie) vs `UNDERAGE` (mineur → refus). Les deux en 403.

**Note front :** le natif collecte la date de naissance à l'onboarding et appelle
`POST /me/complete-onboarding { birthDate }`. Si une route contributive renvoie `403 AGE_REQUIRED`
(compte legacy sans date), afficher l'écran de saisie puis rejouer. `UNDERAGE` = refus définitif.

**Fichiers touchés :** `src/utils/age.ts`, `src/middlewares/requireAdult.ts` (nouveaux), `src/models/User.ts`, `src/zod/user.zod.ts`, `src/utils/AppError.ts`, `src/services/user.service.ts`, `src/controllers/user.controller.ts`, `src/routes/v1/user.route.ts`, `src/routes/v1/tasting.route.ts`

---

## ✅ 4. Suppression de compte — FAIT (2026-06-08)

**Problème :** `DELETE /users/me` ne faisait qu'un `deletedAt` sans limite, et `reviveIfDeleted`
ressuscitait le compte **à chaque requête, indéfiniment** → ni conforme RGPD ni store.

**Stratégie retenue (conforme RGPD art. 17) : suppression en 2 temps.**
1. **Soft-delete** (demande) : `deletedAt` posé, compte masqué partout, **récupérable** au login pendant la période de grâce.
2. **Anonymisation définitive** après la grâce (30j, configurable) : PII effacée, irréversible. Tastings **conservés** (contenu communautaire) avec auteur détaché.

> Le masquage immédiat était déjà en place : tous les services (feed, discover, search, followers,
> likers, mentions, profil public) filtrent déjà `deletedAt: null`. Vérifié à l'audit.

**Fait :**
- [x] [src/models/User.ts](src/models/User.ts) : `anonymizedAt` (distingue récupérable vs définitif), `deletedAt` indexé.
- [x] [src/config/env.ts](src/config/env.ts) : `ACCOUNT_PURGE_GRACE_DAYS` (défaut 30, 1–365).
- [x] [src/utils/grace.ts](src/utils/grace.ts) : `GRACE_MS`, `isGraceExpired()`. Testé sur les bornes (1j/29j/30j/31j) → OK.
- [x] [src/services/account.service.ts](src/services/account.service.ts) :
  - `requestAccountDeletion(user)` — soft-delete idempotent (remplace `softDeleteMe`)
  - `anonymizeAccount(user)` — efface PII (username→`deleted_<id>`, displayName/bio/avatar/cover/location/birthDate→null), **supprime les médias R2**, supprime follows+blocks **et corrige les `followersCount`/`followingCount` des tiers**, purge l'**email côté Better Auth** (collection `user`), nettoie les mentions. Idempotent.
  - `purgeExpiredAccounts()` — anonymise en batch les comptes `deletedAt > 30j` non anonymisés.
- [x] [src/services/user.service.ts](src/services/user.service.ts) : `reviveIfDeleted` **borné** — ressuscite seulement si dans la grâce ET pas anonymisé.
- [x] [src/config/scheduler.ts](src/config/scheduler.ts) : cron node-cron quotidien (03:00 Europe/Paris) → `purgeExpiredAccounts`. Démarré/arrêté dans [server.ts](src/server.ts).
- [x] Controller `deleteMe` → `requestAccountDeletion`.

**Tastings conservés, auteur détaché** (choix validé) : conforme RGPD (un avis détaché de
l'identité n'est plus une donnée perso) et préserve le feed. Pré-requis : pas de PII en clair
dans le contenu des tastings (OK — photos de bouteilles, pas de selfies).

**Limites assumées :**
- Anonymisation **non transactionnelle** (pas de session Mongo multi-doc) — les étapes sont
  idempotentes et `anonymizeAccount` est re-jouable, donc un échec partiel est rattrapé au run suivant.
- Purge de l'email Better Auth en best-effort (log sans throw) — cible la collection `user` par défaut.
- Mono-instance : le scheduler tourne dans l'API. Si scale horizontal → externaliser (lock distribué ou cron externe).

**Fichiers touchés :** `src/services/account.service.ts`, `src/utils/grace.ts`, `src/config/scheduler.ts` (nouveaux), `src/models/User.ts`, `src/config/env.ts`, `src/services/user.service.ts`, `src/controllers/user.controller.ts`, `src/server.ts`, `package.json` (node-cron)

---

## ✅ 4bis. Auth — Sign in with Apple + 2FA (2026-06-08)

> Identifié après coup : un 5e bloquant store passé sous le radar à l'audit initial.

**Apple Sign In — 🔴 BLOQUANT store.** Règle App Store 4.8 : dès qu'un login social tiers est
proposé (Google), Sign in with Apple est **obligatoire**. Absent → rejet iOS garanti.

**Fait :**
- [x] Bump `better-auth` 1.6.11 → **1.6.15** (+ `@better-auth/mongo-adapter` aligné). Non-régression vérifiée (typecheck OK, Google intact). Capacitor compatible (`better-auth >=1.0.0`).
- [x] Dépendance `jose` (génération JWT) en direct.
- [x] [src/config/appleSecret.ts](src/config/appleSecret.ts) : `generateAppleClientSecret()` — JWT ES256, claims Apple, exp 180j. **Testé** (header/claims/exp/signature vérifiés).
- [x] [src/config/env.ts](src/config/env.ts) : 5 vars `APPLE_*` **optionnelles** (Apple s'active seulement si présentes → ne bloque pas dev/staging).
- [x] [src/config/auth.ts](src/config/auth.ts) : provider `apple` conditionnel (+ `appBundleIdentifier` pour le natif iOS), `https://appleid.apple.com` dans `trustedOrigins`. `createAuth`/`initAuth` passés en async (génération JWT).
- [x] Procédure Apple Developer Portal documentée dans le [README](README.md).

**2FA — 🟢 recommandé (comptes admin sensibles).**
- [x] Plugin `twoFactor()` (TOTP + OTP) ajouté. Crée les endpoints `/api/auth/two-factor/*`.
- [x] Optionnel pour les users ; à **exiger pour les admins** (les comptes à privilèges gèrent releases/codes/reports/XP).

**Notes :**
- `generateAppleClientSecret`/`appBundleIdentifier` ne sont PAS des helpers exportés en 1.6.15 → JWT généré maison (jose). `appBundleIdentifier` EST une option valide du provider (typecheck OK).
- Le secret Apple est régénéré à chaque boot (valable 180j) → un redeploy < 180j le rafraîchit. Pas de cron nécessaire pour ça.
- MDP email/password : hashés **scrypt** par Better Auth (natif, rien à faire). Pas de reset password / vérif email câblés (nécessitent un service mail — non bloquant store).

**Reste à faire (toi) :** créer les identifiants Apple Developer + remplir le `.env`. Forcer le
2FA sur les routes admin (middleware) si on veut le rendre obligatoire — voir contrat ci-dessous.

**Fichiers touchés :** `src/config/appleSecret.ts` (nouveau), `src/config/auth.ts`, `src/config/env.ts`, `src/server.ts`, `README.md`, `package.json` (better-auth 1.6.15, jose)

---

## ✅ 5. Export des données (RGPD art. 15 / 20) — FAIT (2026-06-09)

**Problème :** droit d'accès + portabilité obligatoires (UE). PII : `birthDate`, `email`
(Better Auth), `location`, avatars.

**Fait :**
- [x] `GET /api/v1/users/me/export` (requireUser + `exportLimiter` 3/h) → JSON **téléchargeable** (`Content-Disposition: attachment`).
- [x] [exportAccountData()](src/services/account.service.ts) agrège tout : profil (`toJSON`), **email/nom Better Auth**, tastings, likes émis, following, followers, blocks, mentions (émises + reçues), reports émis.
- [x] Réutilise les serializers existants (`toJSON`). URLs des médias R2 incluses (pas les binaires).
- [x] Limiteur dédié `exportLimiter` (opération coûteuse).

**Fichiers touchés :** `src/services/account.service.ts`, `src/controllers/user.controller.ts`, `src/routes/v1/user.route.ts`, `src/middlewares/rateLimit.ts`

---

## ✅ 6. Refacto cohérence — FAIT (2026-06-09, refacto pure, zéro changement de comportement)

**Fait (duplications réelles supprimées) :**
- [x] `isDuplicateKeyError()` — 4 copies identiques (user/like/release/report services) → [src/utils/mongoErrors.ts](src/utils/mongoErrors.ts).
- [x] Pagination — `(page-1)*limit` et `page*limit<total` répétés ~12× → [src/utils/pagination.ts](src/utils/pagination.ts) (`pageSkip`, `hasMorePages`). Migré dans les 6 services (tasting/like/mentions/user/report).

**Volontairement NON fait (risque > gain, consigne « ne pas casser ») :**
- [ ] ~~Extraire `serialize()` tasting~~ → utilisé **uniquement** dans `tasting.controller.ts`, déjà bien encapsulé. Le déplacer ne supprime aucune duplication. Gain nul.
- [ ] ~~Helper `typedQuery<T>`~~ → les `req.query as unknown as T` sont imposés par le typage Express 5 (`ParsedQs`). Un helper ne ferait que déplacer le `as unknown` ; une augmentation de type globale Express est risquée (effets de bord sur tous les handlers).
- [ ] ~~`validate.ts` `next(AppError)` → `throw`~~ → `next(err)` est le pattern Express **correct** pour passer une erreur depuis un middleware sync. Le changer pour le style seul introduit un risque pour zéro gain fonctionnel.
- [ ] ~~Sérialisation manuelle du profil public~~ → exposer `toJSON()` complet leakerait des champs internes (PII, prefs) ; la construction manuelle est **volontaire** (whitelist des champs publics). À ne PAS « simplifier ».

---

## ✅ 7. Auth social-only + corrections de re-audit (2026-06-09)

**Auth social-only :** `emailAndPassword` **désactivé** ([auth.ts](src/config/auth.ts)). Un user
ne s'authentifie que via Apple ou Google → pas de mot de passe côté serveur, donc **pas de reset
password ni de vérification email à implémenter** (et pas de service mail à monter). Réactivable
si besoin (impliquerait alors de câbler `sendResetPassword`).

**Corrections d'un 2e audit ciblé "première soumission" :**
- [x] **Health check** teste maintenant la connectivité Mongo (ping) → `503` si DB déconnectée ([app.ts](src/app.ts)). L'hébergeur ne croit plus l'API saine alors qu'elle est coupée de la base.
- [x] **Likes orphelins** : `deleteTasting` purge désormais les `Like` du tasting supprimé ([tasting.service.ts](src/services/tasting.service.ts)).
- [x] **Mentions à l'anonymisation** : bug réel — `clearMentions('bio', …)` ne couvrait que la bio. Remplacé par une suppression de **toutes** les mentions où l'user est auteur OU cible (y compris dans les tastings) ([account.service.ts](src/services/account.service.ts)).

**Faux positifs écartés (vérifiés, NON modifiés) :**
- `z.iso.datetime()` dans [user.zod.ts](src/zod/user.zod.ts) — **valide en Zod 4** (testé : ISO ok, null ok, default ok, invalide rejeté). L'audit raisonnait sur Zod 3.

**Laissés volontairement (propreté, non bloquants) :**
- Likes/mentions résiduels au **blocage** d'un user : non visibles via le filtre de block, impact nul.
- Validation **magic bytes** des uploads (au-delà du MIME) : sharp rejette déjà le contenu non-image au traitement. Durcissement possible plus tard.

**Décision front/contenu (pas un trou back) :**
- **Pages CGU / Privacy publiques** : les stores exigent une **URL publique** de politique de
  confidentialité. À héberger côté **front** (`buvard.app/privacy`, `/terms`) — pas dans l'API.
  Les endpoints `accept-terms` / `accept-privacy` (back) existent déjà ; c'est au front de
  bloquer l'onboarding tant que non accepté.

**Fichiers touchés :** `src/config/auth.ts`, `src/app.ts`, `src/services/tasting.service.ts`, `src/services/account.service.ts`

---

## ✨ Feature MVP — Notifications in-app (2026-06-09)

> Pas un sujet store : feature produit. Le model User prévoyait déjà
> `prefs.notifications.*` mais aucune notif n'était générée → le feed social était « muet ».

**Fait :**
- [x] Model [Notification.ts](src/models/Notification.ts) : `userId` (destinataire), `type` (follow|like|mention), `actorId`, `tastingId?`, `readAt`. Index `(userId, createdAt)` + `(userId, readAt)`.
- [x] Service [notification.service.ts](src/services/notification.service.ts) : `createNotification` (anti-self + respect des prefs `newFollower`/`tastingLiked`), `listNotifications` (paginé + `unreadCount`, acteur populé, masque les acteurs supprimés), `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`.
- [x] **Génération non bloquante** (`void createNotification(...)`, try/catch interne) branchée sur : follow ([user.service.ts](src/services/user.service.ts)), like ([like.service.ts](src/services/like.service.ts), 1 seule fois par like), nouvelle mention ([mentions.service.ts](src/services/mentions.service.ts), sur `toCreate` uniquement).
- [x] Intégrité : notifs purgées à l'anonymisation de compte + incluses dans l'export RGPD.
- [x] Pas de notif entre users bloqués (les actions like/follow/mention sont déjà bloquées en amont).

**Volontairement hors scope (chantier séparé) :** **push natif** (APNs / FCM). Les notifs sont
in-app uniquement pour l'instant — le front les récupère en polling (`unread-count` + liste). Le
push temps réel viendra après (nécessite tokens device + intégration APNs/FCM).

**Fichiers :** `src/models/Notification.ts`, `src/services/notification.service.ts`, `src/controllers/notification.controller.ts`, `src/zod/notification.zod.ts` (nouveaux), `src/routes/v1/user.route.ts`, `src/services/{user,like,mentions,account}.service.ts`

---

## Déjà conforme (✓ — ne rien faire)

- Blocage utilisateur (model Block + routes + filtres mentions/search/like)
- CGU / Privacy : champs `acceptedTermsAt` / `acceptedPrivacyAt` présents (vérifier qu'ils sont remplis à l'onboarding)
- Uploads : limites taille + whitelist MIME + conversion sharp/webp
- Validation Zod sur la quasi-totalité des endpoints, pagination bornée (max 20–100)
- Authz hiérarchique (requireUser / requireActive / requireRole), admin protégé
- Pas d'injection Mongo (regex échappée dans searchUsers, pas de $where)
- Logs redactés (authorization, cookie, password, token, secret)
- Graceful shutdown, env validé au boot (Zod)

---

## Checklist métadonnées store (hors code, à préparer en parallèle)

- [ ] Page web CGU + Politique de confidentialité accessibles publiquement (URL requise par les stores)
- [ ] Classification d'âge 17+/18+ (Apple) et IARC/PEGI (Google) déclarée
- [ ] Texte de modération UGC dans les notes de review Apple (engagement délai d'action)
- [ ] App Privacy "Nutrition Label" Apple : déclarer les données collectées (email, localisation, etc.)

---

# Contrat API (référence front)

> Documentation des endpoints **livrés**, pour l'intégration front. Mise à jour au fur et à
> mesure des chantiers. Base URL : `PUBLIC_API_URL` (ex. `https://api.buvard.app`).

## Conventions communes

**Format d'erreur** (toutes les routes) :
```json
{ "error": { "code": "BAD_REQUEST", "message": "...", "details": { } } }
```
`code` ∈ `BAD_REQUEST` (400) · `UNAUTHORIZED` (401) · `FORBIDDEN` (403) · `AGE_REQUIRED` (403) ·
`UNDERAGE` (403) · `NOT_FOUND` (404) · `CONFLICT` (409) · `UNPROCESSABLE` (422) ·
`TOO_MANY_REQUESTS` (429) · `INTERNAL` (500).
`details` n'est présent que sur les erreurs de validation Zod (arbre des champs invalides).

> **Age gate** : `AGE_REQUIRED` = pas de date de naissance enregistrée → le front affiche
> l'écran de saisie d'âge puis rejoue la requête. `UNDERAGE` = mineur → refus définitif.

**Auth** : session Better Auth via cookie (web) ou `Authorization: Bearer <token>` (natif Capacitor).
Routes marquées *auth* exigent une session. *actif* = compte non banni/suspendu. *admin* = role admin.

**Rate limiting** : en cas de dépassement → `429 { error: { code: "TOO_MANY_REQUESTS" } }`.
Headers `RateLimit-*` (draft-8) renvoyés. Limites prod :
| Limiteur | Portée | Limite prod |
|---|---|---|
| auth | `/api/auth/*` | 10 / 15 min / IP |
| api (global) | `/api/*` | 120 / min |
| upload | avatar, cover, photos | 30 / h |
| redeem | redeem-code | 5 / h |
| mutation | follow, block, like, création tasting, **report** | 60 / min |
| export | export RGPD | 3 / h |

**Format ressource** : tous les objets renvoyés ont `id` (string, jamais `_id`) + `createdAt`/`updatedAt` (ISO 8601).

---

## Signalement (report)

### `POST /api/v1/tastings/:id/report` — *auth, actif*
Signale un tasting. `:id` = ObjectId du tasting (24 hex).

Body :
```json
{ "reason": "spam", "note": "optionnel, max 500 chars" }
```
`reason` ∈ `"spam"` · `"harassment"` · `"inappropriate"` · `"underage"` · `"impersonation"` · `"other"`

Réponses :
- `201 Created` — nouveau signalement : `{ "report": { ...Report }, "alreadyReported": false }`
- `200 OK` — déjà signalé (idempotent) : `{ "report": { ...Report }, "alreadyReported": true }`

Erreurs : `400` reason invalide / auto-signalement · `401` non auth · `404` tasting introuvable · `429` rate limit.

### `POST /api/v1/users/:username/report` — *auth, actif*
Signale un user. `:username` = username (pas l'id). Body et réponses **identiques** à ci-dessus.
Erreurs : `400` auto-signalement · `404` user introuvable · idem.

### Objet `Report` (renvoyé au reporter)
```json
{
  "id": "string",
  "reporterId": "string",
  "targetType": "tasting | user",
  "targetId": "string",
  "reason": "spam | harassment | inappropriate | underage | impersonation | other",
  "note": "string | absent",
  "status": "pending | reviewed | actioned | dismissed",
  "reviewedBy": "string | null",
  "reviewedAt": "ISO 8601 | null",
  "resolutionNote": "string | null (note interne modération)",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```
> Le front n'affiche normalement que la confirmation (`alreadyReported`). Les champs `reviewedBy`/
> `resolutionNote` sont surtout pertinents côté admin.

### `GET /api/v1/admin/reports` — *admin*
File de modération. Query : `?status=pending&page=1&limit=20` (status optionnel, limit max 100).
Réponse :
```json
{ "data": [ { ...Report, "reporterId": { "id", "username", "displayName", "avatarUrl" } } ],
  "page": 1, "limit": 20, "total": 42, "hasMore": true }
```
> `reporterId` est **populé** (objet user minimal) dans cette réponse admin, contrairement au POST.

### `PATCH /api/v1/admin/reports/:id` — *admin*
Résout un signalement. Body :
```json
{ "status": "reviewed | actioned | dismissed", "resolutionNote": "optionnel" }
```
(`pending` interdit en entrée.) Réponse : `200 { "report": { ...Report } }`. Erreur : `404` introuvable.

---

## Onboarding & age gate

> App d'alcool → tout user doit prouver sa majorité. La date de naissance est la source de
> vérité (`birthDate`, calcul d'âge exact). `birthYear` est déprécié (dérivé, lecture seule).

### `POST /api/v1/users/me/complete-onboarding` — *auth*
Termine l'onboarding. **Exige la date de naissance** (1ère barrière de l'age gate).

Body :
```json
{ "birthDate": "2000-05-14" }
```
`birthDate` : string ISO (`YYYY-MM-DD`) ou datetime ISO. Doit être ≥ 18 ans, entre 1900 et aujourd'hui.

Réponses :
- `200 OK` : `{ "onboardingCompletedAt": "ISO 8601" }`
- `400 BAD_REQUEST` : date manquante / mal formée / dans le futur
- `400` (validation Zod) ou `403 UNDERAGE` : âge < 18 (le refus peut venir de Zod en `BAD_REQUEST` avec `details`, ou du service en `UNDERAGE` — le front traite les deux comme « trop jeune »)

> Peut être rappelé même après onboarding terminé : met simplement à jour `birthDate` (utile
> pour le rattrapage des comptes legacy sans date).

### `PATCH /api/v1/users/me` — *auth, actif* (champ age modifié)
Accepte désormais `birthDate` (string ISO, ≥ 18 ans) **à la place de** `birthYear` (qui n'est
plus accepté en entrée). Les autres champs (`username`, `displayName`, `bio`, `location`,
`favoriteCategories`) sont inchangés.

### Comportement age gate sur les routes contributives
`POST /api/v1/tastings` et `POST /api/v1/tastings/:id/photos` exigent un compte majeur :
- `403 { code: "AGE_REQUIRED" }` → compte sans `birthDate` (legacy / onboarding non fait). Front : écran de saisie, puis rejouer.
- `403 { code: "UNDERAGE" }` → date présente mais < 18. Front : refus.

### Objet user (`birthDate`)
`GET /me` renvoie `birthDate` (ISO 8601 ou `null`) et `birthYear` (number ou absent, dérivé).
Le profil public d'**autres** users **n'expose pas** `birthDate` (PII, sérialisation séparée).

---

## Notifications (in-app)

> Notifications in-app générées sur follow / like / mention. Pas de push natif pour l'instant —
> le front les récupère en polling. Respectent `prefs.notifications.newFollower` / `tastingLiked`.

### `GET /api/v1/users/me/notifications?page=&limit=` — *auth*
Liste paginée, plus récentes d'abord (`limit` max 50). Réponse :
```json
{
  "data": [
    {
      "id": "string",
      "type": "follow | like | mention",
      "tastingId": "string | null",
      "readAt": "ISO 8601 | null",
      "createdAt": "ISO 8601",
      "actor": { "id", "username", "displayName", "avatarUrl" }
    }
  ],
  "page": 1, "limit": 20, "total": 12, "unreadCount": 3, "hasMore": false
}
```
- `actor` = qui a déclenché (a liké/suivi/mentionné). Les notifs dont l'acteur a supprimé son compte sont **filtrées** (masquées).
- `tastingId` présent pour `like` et `mention` dans des notes ; `null` pour `follow` / mention en bio.

### `GET /api/v1/users/me/notifications/unread-count` — *auth*
Badge de non-lues : `{ "unreadCount": 3 }`. Léger, à appeler en polling.

### `POST /api/v1/users/me/notifications/read` — *auth*
Marque **toutes** les notifs comme lues. Réponse : `{ "marked": 3 }`.

### `POST /api/v1/users/me/notifications/:id/read` — *auth*
Marque **une** notif comme lue (idempotent). Réponse : `204`. `:id` = ObjectId.

---

## Export des données (RGPD)

### `GET /api/v1/users/me/export` — *auth*
Exporte toutes les données de l'user (droit d'accès art. 15 + portabilité art. 20).
Réponse : `200`, `Content-Type: application/json`, `Content-Disposition: attachment;
filename="buvard-export.json"` → le client peut directement enregistrer le fichier.

Structure du JSON :
```json
{
  "exportedAt": "ISO 8601",
  "format": "buvard-account-export-v1",
  "account": {
    "profile": { ...user complet (toJSON) },
    "auth": { "email": "...", "name": "...", "emailVerified": bool, "createdAt": "..." }
  },
  "tastings": [ { ...Tasting } ],
  "likesGiven": [ { "tastingId": "...", "createdAt": "..." } ],
  "following":  [ { "userId": "...", "since": "..." } ],
  "followers":  [ { "userId": "...", "since": "..." } ],
  "blocks":     [ { "userId": "...", "since": "..." } ],
  "mentions": {
    "made":     [ { "mentionedUserId", "sourceType", "sourceId", "createdAt" } ],
    "received": [ { "byUserId", "sourceType", "sourceId", "createdAt" } ]
  },
  "reportsMade": [ { ...Report } ]
}
```
Rate limité à 3/h (opération coûteuse). Erreurs : `401`, `429`.

---

## Suppression de compte

> Suppression en 2 temps (RGPD). Le front doit informer l'user de la période de grâce.

### `DELETE /api/v1/users/me` — *auth*
Demande la suppression du compte (soft-delete). Réponse : `204 No Content`.
- Le compte est **immédiatement masqué** partout (profil, feed, recherche, likers, followers).
- **Récupérable pendant 30 jours** : il suffit que l'user se reconnecte (toute requête
  authentifiée dans la fenêtre réactive le compte automatiquement).
- Après 30 jours : **anonymisation définitive et irréversible** (PII effacée). Les dégustations
  sont conservées mais l'auteur devient anonyme. Au-delà, la reconnexion ne restaure plus rien.

Idempotent : appeler `DELETE /me` sur un compte déjà en suppression ne change rien (204).

### Récupération (annulation de la demande)
Pas d'endpoint dédié et c'est volontaire : la réactivation est **automatique**. Toute requête
authentifiée dans les 30 jours (login, ou `GET /me`) repasse `deletedAt` à null côté serveur
**avant** de répondre. Donc dès que l'user revient dans l'app, son compte est déjà restauré —
le front n'a rien à faire de spécial. Après 30 jours (compte anonymisé), la session ne restaure
plus rien : le front doit traiter ça comme un compte inexistant (déconnexion / re-signup).

> Note d'implémentation : comme le revive est fait au chargement de la session, un `GET /me`
> ne renverra jamais `deletedAt` non-null pour un compte encore récupérable (l'appel l'a déjà
> réactivé). `anonymizedAt` est toujours null pour un compte vivant. Le profil public d'autrui
> n'expose ni `deletedAt` ni `anonymizedAt`.

---

## Auth (Better Auth)

Géré par Better Auth sous `/api/auth/*`. Le natif passe le `session_token` en
`Authorization: Bearer` via le plugin Capacitor.

**Providers sociaux disponibles** : `google`, `apple`.
- Web : `POST /api/auth/sign-in/social` `{ provider: "apple" | "google", callbackURL }`.
- Natif iOS : flux **idToken** — l'app récupère l'idToken Apple via le SDK natif et l'envoie
  à Better Auth. Côté serveur le `appBundleIdentifier` est configuré pour valider cet idToken.
- ⚠️ **Apple n'envoie l'email qu'à la 1ère connexion** (jamais ensuite, pas d'endpoint pour le
  récupérer). Le back gère ça (matching sur l'id Apple, fallback username `user_<id>` si pas
  d'email) — rien à faire côté front, mais à savoir.

**Email + mot de passe** : **DÉSACTIVÉ** (auth social-only). Les endpoints `sign-up/email` /
`sign-in/email` ne sont pas disponibles. Le front ne doit proposer que Apple + Google.

**2FA** (plugin twoFactor) : endpoints `/api/auth/two-factor/*` (enable, verify-totp, etc.).
Optionnel pour les users. **Prévu obligatoire pour les admins** : si on active le forçage, un
admin sans 2FA configuré recevra un refus sur les routes admin tant qu'il n'a pas activé son TOTP.
Le front admin devra donc gérer le flux d'enrôlement 2FA. Voir la doc Better Auth twoFactor pour
le détail des payloads (QR/secret TOTP, codes de récupération).

> Pour le détail exhaustif des payloads Better Auth (session, sign-out, etc.), se référer à la
> doc Better Auth — non recopiée ici.
