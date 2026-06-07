import type { Types } from 'mongoose';
import sharp from 'sharp';
import { AppError } from '../utils/AppError.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { TastingModel } from '../models/Tasting.js';
import { FollowModel } from '../models/Follow.js';
import { BlockModel } from '../models/Block.js';
import { deleteObject, extractKeyFromPublicUrl, uploadBuffer } from './storage.service.js';
import { clearMentions, syncMentions } from './mentions.service.js';
import { getGradeForLevel, getGradeByKey as getGradeByKeyCached } from './grade.service.js';
import type { ListFollowsQuery, UpdateMeInput, UpdatePrefsInput } from '../zod/user.zod.js';

// Valeurs par defaut des prefs — utilisees aussi en fallback pour d'eventuels users legacy
const DEFAULT_PREFS = {
  theme: 'system' as const,
  language: 'fr' as const,
  units: 'metric' as const,
  currency: 'EUR' as const,
  notifications: {
    push: true,
    email: false,
    friendActivity: true,
    newFollower: true,
    tastingLiked: true,
    tastingCommented: true,
  },
  privacy: {
    profilePublic: true,
    showRatings: true,
    searchable: true,
    showLocation: true,
  },
};

// Anti-spam pour lastSeenAt: pas d'update si vu il y a moins d'1 min
const LAST_SEEN_THROTTLE_MS = 60_000;

// Erreur Mongo de cle dupliquee (index unique viole)
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 11000;
}

// Genere un username unique a partir d'une base proposee par l'auth provider
async function ensureUniqueUsername(base: string): Promise<string> {
  const normalized =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 28) || 'user';

  let candidate = normalized;
  let suffix = 0;
  while (await UserModel.exists({ username: candidate })) {
    suffix += 1;
    candidate = `${normalized}${suffix}`.slice(0, 32);
    if (suffix > 9999) {
      candidate = `${normalized.slice(0, 22)}${Date.now().toString(36)}`.slice(0, 32);
      break;
    }
  }
  return candidate;
}

// Si l'user a ete soft-delete, on le restaure quand il revient
async function reviveIfDeleted(doc: UserDoc): Promise<UserDoc> {
  if (doc.deletedAt) {
    doc.deletedAt = null;
    await doc.save();
  }
  return doc;
}

// Update non-bloquant de lastSeenAt — throttle pour eviter une ecriture par requete
async function touchLastSeen(doc: UserDoc): Promise<void> {
  const last = doc.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - last < LAST_SEEN_THROTTLE_MS) return;
  const now = new Date();
  doc.lastSeenAt = now;
  await UserModel.updateOne({ _id: doc._id }, { $set: { lastSeenAt: now } });
}

interface CreateSeed {
  authUserId: string;
  baseUsername: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// Cree un user en gerant les races (authUserId/username dupliques entre process concurrents)
async function createUserSafely(seed: CreateSeed): Promise<UserDoc> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const username = await ensureUniqueUsername(seed.baseUsername);
    try {
      return await UserModel.create({
        authUserId: seed.authUserId,
        username,
        displayName: seed.displayName || username,
        avatarUrl: seed.avatarUrl || undefined,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Dupe sur authUserId: un autre process a deja insere ce user
      const byAuth = await UserModel.findOne({ authUserId: seed.authUserId });
      if (byAuth) return reviveIfDeleted(byAuth);
      // Sinon dupe sur username: on retry avec un nouveau candidat
    }
  }
  throw AppError.conflict('Impossible de creer le user, conflit persistant');
}

// Objet user provenant d'une session Better Auth
export interface AuthUserSeed {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}

// Sync paresseuse : a la 1ere requete authentifiee, on cree (ou retrouve) le
// profil etendu lie a l'user Better Auth.
export async function findOrCreateUserFromAuth(authUser: AuthUserSeed): Promise<UserDoc> {
  const existing = await UserModel.findOne({ authUserId: authUser.id });
  if (existing) {
    const revived = await reviveIfDeleted(existing);
    await touchLastSeen(revived);
    return revived;
  }

  const emailPrefix = authUser.email ? authUser.email.split('@')[0] || null : null;
  const baseUsername = emailPrefix || `user_${authUser.id.slice(-6)}`;

  return createUserSafely({
    authUserId: authUser.id,
    baseUsername,
    displayName: authUser.name || null,
    avatarUrl: authUser.image || null,
  });
}

export async function softDeleteMe(user: UserDoc): Promise<void> {
  user.deletedAt = new Date();
  await user.save();
  await clearMentions('bio', user._id);
}

export async function getUserByUsername(username: string): Promise<UserDoc> {
  const user = await UserModel.findOne({ username, deletedAt: null });
  if (!user) throw AppError.notFound('Utilisateur introuvable');
  return user;
}

export async function updateMe(user: UserDoc, input: UpdateMeInput): Promise<UserDoc> {
  if (input.username && input.username !== user.username) {
    const taken = await UserModel.exists({ username: input.username });
    if (taken) throw AppError.conflict('Username deja pris');
    user.username = input.username;
  }
  if (input.displayName !== undefined) user.displayName = input.displayName;
  const bioChanged = input.bio !== undefined && input.bio !== user.bio;
  if (input.bio !== undefined) user.bio = input.bio;
  // avatarUrl / coverUrl ne sont plus dans le schema de PATCH /me : ils sont
  // setes uniquement via les endpoints d'upload R2 dedies.
  if (input.birthYear !== undefined) user.birthYear = input.birthYear;
  if (input.favoriteCategories !== undefined) user.favoriteCategories = input.favoriteCategories;
  if (input.location !== undefined) {
    user.location = {
      country: input.location.country,
      city: input.location.city,
    };
  }
  await user.save();

  // Re-synchronise les mentions de la bio si elle a change
  if (bioChanged) {
    await syncMentions({
      sourceType: 'bio',
      sourceId: user._id,
      mentionerId: user._id,
      text: user.bio,
    });
  }
  // Apres tout changement de profil, check si on franchit le seuil "profil
  // complet" (avatar + bio + location.city) pour la 1ere fois.
  await tryGrantProfileCompleteBonus(user);
  return user;
}

export function getPrefs(user: UserDoc) {
  return user.prefs ?? DEFAULT_PREFS;
}

export async function updatePrefs(user: UserDoc, input: UpdatePrefsInput) {
  if (!user.prefs) user.prefs = { ...DEFAULT_PREFS };

  if (input.theme !== undefined) user.prefs.theme = input.theme;
  if (input.language !== undefined) user.prefs.language = input.language;
  if (input.units !== undefined) user.prefs.units = input.units;
  if (input.currency !== undefined) user.prefs.currency = input.currency;

  if (input.notifications) {
    if (!user.prefs.notifications) user.prefs.notifications = { ...DEFAULT_PREFS.notifications };
    const src = input.notifications;
    const dst = user.prefs.notifications;
    if (src.push !== undefined) dst.push = src.push;
    if (src.email !== undefined) dst.email = src.email;
    if (src.friendActivity !== undefined) dst.friendActivity = src.friendActivity;
    if (src.newFollower !== undefined) dst.newFollower = src.newFollower;
    if (src.tastingLiked !== undefined) dst.tastingLiked = src.tastingLiked;
    if (src.tastingCommented !== undefined) dst.tastingCommented = src.tastingCommented;
  }
  if (input.privacy) {
    if (!user.prefs.privacy) user.prefs.privacy = { ...DEFAULT_PREFS.privacy };
    const src = input.privacy;
    const dst = user.prefs.privacy;
    if (src.profilePublic !== undefined) dst.profilePublic = src.profilePublic;
    if (src.showRatings !== undefined) dst.showRatings = src.showRatings;
    if (src.searchable !== undefined) dst.searchable = src.searchable;
    if (src.showLocation !== undefined) dst.showLocation = src.showLocation;
  }

  await user.save();
  return getPrefs(user);
}

export async function getMyStats(user: UserDoc) {
  // On lit les stats denormalisees (rapides) et on tombe en fallback sur countDocuments
  // si elles n'ont jamais ete initialisees (users legacy)
  const denormalized = user.stats?.tastingsCount;
  const tastingCount =
    typeof denormalized === 'number'
      ? denormalized
      : await TastingModel.countDocuments({ userId: user._id, deletedAt: null });

  return {
    tastingCount,
    tastingsByCategory: user.stats?.tastingsByCategory ?? {},
    followersCount: user.stats?.followersCount ?? 0,
    followingCount: user.stats?.followingCount ?? 0,
    gamification: user.gamification ?? {
      xp: 0,
      level: 1,
      grade: 'curious',
      displayGrade: null,
      streak: { current: 0, longest: 0, lastActiveAt: null },
    },
    joinDate: user.createdAt,
  };
}

// --- Onboarding & legal ---

export async function completeOnboarding(user: UserDoc): Promise<UserDoc> {
  if (!user.onboardingCompletedAt) {
    user.onboardingCompletedAt = new Date();
    await user.save();
    // Bonus XP one-shot pour avoir termine l'onboarding.
    await grantXp(user._id, XP_ONBOARDING);
  }
  return user;
}

export async function acceptTerms(user: UserDoc): Promise<UserDoc> {
  user.acceptedTermsAt = new Date();
  await user.save();
  return user;
}

export async function acceptPrivacy(user: UserDoc): Promise<UserDoc> {
  user.acceptedPrivacyAt = new Date();
  await user.save();
  return user;
}

// --- Social: Follow ---

async function isBlocked(aId: Types.ObjectId, bId: Types.ObjectId): Promise<boolean> {
  const found = await BlockModel.exists({
    $or: [
      { blockerId: aId, blockedId: bId },
      { blockerId: bId, blockedId: aId },
    ],
  });
  return Boolean(found);
}

// Relation du viewer connecte vis-a-vis d'un profil cible (UI : suivre / bloquer).
// isBlocked ici est DIRECTIONNEL (viewer -> cible) pour piloter le bouton Bloquer/Debloquer.
export async function getViewerRelationship(
  viewerId: Types.ObjectId,
  targetId: Types.ObjectId,
): Promise<{ isFollowing: boolean; isBlocked: boolean }> {
  if (viewerId.equals(targetId)) return { isFollowing: false, isBlocked: false };
  const [following, blocked] = await Promise.all([
    FollowModel.exists({ followerId: viewerId, followingId: targetId }),
    BlockModel.exists({ blockerId: viewerId, blockedId: targetId }),
  ]);
  return { isFollowing: Boolean(following), isBlocked: Boolean(blocked) };
}

export async function followUser(actor: UserDoc, targetUsername: string): Promise<void> {
  const target = await getUserByUsername(targetUsername);
  if (target._id.equals(actor._id)) throw AppError.badRequest('On ne peut pas se suivre soi-meme');

  if (await isBlocked(actor._id, target._id)) {
    throw AppError.forbidden('Action impossible suite a un blocage');
  }

  try {
    await FollowModel.create({ followerId: actor._id, followingId: target._id });
  } catch (err) {
    if (isDuplicateKeyError(err)) return; // deja follow, idempotent
    throw err;
  }

  // Incrementations atomiques des compteurs denormalises
  await Promise.all([
    UserModel.updateOne({ _id: actor._id }, { $inc: { 'stats.followingCount': 1 } }),
    UserModel.updateOne({ _id: target._id }, { $inc: { 'stats.followersCount': 1 } }),
  ]);

  // Bonus XP au target : +5 par follower + 20 one-shot pour le 1er. On lit
  // followersCount *avant* l'increment de la ligne au-dessus (donc 0 si c'est
  // le 1er), via l'objet target deja en memoire.
  const prevFollowers = target.stats?.followersCount ?? 0;
  let bonus = XP_PER_FOLLOWER;
  if (prevFollowers === 0 && !target.gamification?.bonusesGranted?.firstFollower) {
    bonus += XP_FIRST_FOLLOWER;
    await UserModel.updateOne(
      { _id: target._id },
      { $set: { 'gamification.bonusesGranted.firstFollower': true } },
    );
  }
  await grantXp(target._id, bonus);
}

export async function unfollowUser(actor: UserDoc, targetUsername: string): Promise<void> {
  const target = await getUserByUsername(targetUsername);
  const result = await FollowModel.deleteOne({ followerId: actor._id, followingId: target._id });
  if (result.deletedCount === 0) return; // pas follow, idempotent

  await Promise.all([
    UserModel.updateOne({ _id: actor._id }, { $inc: { 'stats.followingCount': -1 } }),
    UserModel.updateOne({ _id: target._id }, { $inc: { 'stats.followersCount': -1 } }),
  ]);
}

interface PaginatedUsers {
  data: Array<{
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
  }>;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

async function paginateUserIds(
  filter: Record<string, unknown>,
  idField: 'followerId' | 'followingId',
  query: ListFollowsQuery,
): Promise<PaginatedUsers> {
  const [edges, total] = await Promise.all([
    FollowModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .select(idField),
    FollowModel.countDocuments(filter),
  ]);

  const userIds = edges.map((e) => e[idField]);
  const users = await UserModel.find({ _id: { $in: userIds }, deletedAt: null }).select(
    'username displayName avatarUrl bio',
  );

  // Reordonne selon l'ordre des edges (createdAt desc)
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const data = userIds
    .map((id) => byId.get(id.toString()))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      id: String(u._id),
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      bio: u.bio,
    }));

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
  };
}

export async function listFollowers(username: string, query: ListFollowsQuery): Promise<PaginatedUsers> {
  const target = await getUserByUsername(username);
  if (target.prefs?.privacy?.profilePublic === false) {
    throw AppError.notFound('Utilisateur introuvable');
  }
  return paginateUserIds({ followingId: target._id }, 'followerId', query);
}

export async function listFollowing(username: string, query: ListFollowsQuery): Promise<PaginatedUsers> {
  const target = await getUserByUsername(username);
  if (target.prefs?.privacy?.profilePublic === false) {
    throw AppError.notFound('Utilisateur introuvable');
  }
  return paginateUserIds({ followerId: target._id }, 'followingId', query);
}

// --- Social: Block ---

export async function blockUser(actor: UserDoc, targetUsername: string): Promise<void> {
  const target = await getUserByUsername(targetUsername);
  if (target._id.equals(actor._id)) throw AppError.badRequest('On ne peut pas se bloquer soi-meme');

  try {
    await BlockModel.create({ blockerId: actor._id, blockedId: target._id });
  } catch (err) {
    if (isDuplicateKeyError(err)) return; // deja block, idempotent
    throw err;
  }

  // Un block coupe la relation de follow dans les deux sens
  const [removedFromActor, removedFromTarget] = await Promise.all([
    FollowModel.deleteOne({ followerId: actor._id, followingId: target._id }),
    FollowModel.deleteOne({ followerId: target._id, followingId: actor._id }),
  ]);

  const ops: Array<Promise<unknown>> = [];
  if (removedFromActor.deletedCount) {
    ops.push(
      UserModel.updateOne({ _id: actor._id }, { $inc: { 'stats.followingCount': -1 } }),
      UserModel.updateOne({ _id: target._id }, { $inc: { 'stats.followersCount': -1 } }),
    );
  }
  if (removedFromTarget.deletedCount) {
    ops.push(
      UserModel.updateOne({ _id: target._id }, { $inc: { 'stats.followingCount': -1 } }),
      UserModel.updateOne({ _id: actor._id }, { $inc: { 'stats.followersCount': -1 } }),
    );
  }
  if (ops.length) await Promise.all(ops);
}

export async function unblockUser(actor: UserDoc, targetUsername: string): Promise<void> {
  const target = await getUserByUsername(targetUsername);
  await BlockModel.deleteOne({ blockerId: actor._id, blockedId: target._id });
}

export async function listBlocks(actor: UserDoc, query: ListFollowsQuery): Promise<PaginatedUsers> {
  const filter = { blockerId: actor._id };
  const [edges, total] = await Promise.all([
    BlockModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .select('blockedId'),
    BlockModel.countDocuments(filter),
  ]);

  const ids = edges.map((e) => e.blockedId);
  // Exclut les comptes soft-deletes : ils ne doivent plus apparaitre dans la
  // liste meme si le block existe encore.
  const users = await UserModel.find({ _id: { $in: ids }, deletedAt: null }).select('username displayName avatarUrl bio');
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const data = ids
    .map((id) => byId.get(id.toString()))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      id: String(u._id),
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      bio: u.bio,
    }));

  return { data, page: query.page, limit: query.limit, total, hasMore: query.page * query.limit < total };
}

// --- Images: avatar & cover ---

// Dimensions cibles apres resize. WebP qualite 85 = excellent compromis qualite/poids.
const AVATAR_SIZE = 400;
const COVER_WIDTH = 1500;
const COVER_HEIGHT = 500;
const WEBP_QUALITY = 85;

interface ImageVariant {
  field: 'avatarUrl' | 'coverUrl';
  prefix: 'avatars' | 'covers';
  resize: (input: Buffer) => sharp.Sharp;
}

const AVATAR_VARIANT: ImageVariant = {
  field: 'avatarUrl',
  prefix: 'avatars',
  resize: (input) => sharp(input).rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }),
};

const COVER_VARIANT: ImageVariant = {
  field: 'coverUrl',
  prefix: 'covers',
  resize: (input) => sharp(input).rotate().resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover' }),
};

async function processAndStoreImage(user: UserDoc, file: Buffer, variant: ImageVariant): Promise<string> {
  const optimized = await variant.resize(file).webp({ quality: WEBP_QUALITY }).toBuffer();
  const key = `${variant.prefix}/${String(user._id)}/${Date.now()}.webp`;
  const { publicUrl } = await uploadBuffer(key, optimized, 'image/webp');
  return publicUrl;
}

async function deleteOldImage(previousUrl: string | undefined | null): Promise<void> {
  const key = extractKeyFromPublicUrl(previousUrl);
  if (key) await deleteObject(key);
}

export async function setAvatar(user: UserDoc, file: Buffer): Promise<UserDoc> {
  const previous = user.avatarUrl;
  const newUrl = await processAndStoreImage(user, file, AVATAR_VARIANT);
  user.avatarUrl = newUrl;
  await user.save();
  // Best-effort: on supprime l'ancien apres le save reussi
  if (previous && previous !== newUrl) await deleteOldImage(previous);
  // Setter un avatar peut completer le profil — check du bonus one-shot.
  await tryGrantProfileCompleteBonus(user);
  return user;
}

export async function setCover(user: UserDoc, file: Buffer): Promise<UserDoc> {
  const previous = user.coverUrl;
  const newUrl = await processAndStoreImage(user, file, COVER_VARIANT);
  user.coverUrl = newUrl;
  await user.save();
  if (previous && previous !== newUrl) await deleteOldImage(previous);
  return user;
}

export async function removeAvatar(user: UserDoc): Promise<UserDoc> {
  const previous = user.avatarUrl;
  if (!previous) return user;
  user.avatarUrl = undefined;
  await user.save();
  await deleteOldImage(previous);
  return user;
}

export async function removeCover(user: UserDoc): Promise<UserDoc> {
  const previous = user.coverUrl;
  if (!previous) return user;
  user.coverUrl = undefined;
  await user.save();
  await deleteOldImage(previous);
  return user;
}

// --- Search users (autocomplete @mention, etc.) ---

interface UserSearchResult {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  verified: boolean;
}

// Escape les caracteres regex pour eviter une injection via la query
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchUsers(
  q: string,
  limit: number,
  viewer: UserDoc | null,
): Promise<UserSearchResult[]> {
  const safe = escapeRegex(q.toLowerCase());
  const filter: Record<string, unknown> = {
    deletedAt: null,
    status: 'active',
    $or: [
      { username: { $regex: `^${safe}`, $options: 'i' } },
      { displayName: { $regex: safe, $options: 'i' } },
    ],
  };

  // Respecte le flag searchable (priv defaut true, on accepte aussi absent)
  filter['prefs.privacy.searchable'] = { $ne: false };

  // Exclut les users impliques dans un block avec le viewer (dans un sens ou l'autre)
  if (viewer) {
    const blocks = await BlockModel.find({
      $or: [{ blockerId: viewer._id }, { blockedId: viewer._id }],
    }).select('blockerId blockedId');
    const excludeIds = new Set<string>();
    for (const b of blocks) {
      excludeIds.add(b.blockerId.equals(viewer._id) ? b.blockedId.toString() : b.blockerId.toString());
    }
    excludeIds.add(viewer._id.toString()); // ne pas se retourner soi-meme
    if (excludeIds.size > 0) {
      filter._id = { $nin: Array.from(excludeIds) };
    }
  }

  const users = await UserModel.find(filter)
    .select('username displayName avatarUrl verified')
    .limit(limit);

  return users.map((u) => ({
    id: String(u._id),
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    verified: u.verified ?? false,
  }));
}

// --- Gamification : XP + level + streak ---

// Bareme XP. Toutes les valeurs sont centralisees ici pour pouvoir ajuster
// l'economie en un seul endroit. Si l'on touche une valeur ici, penser a
// mettre a jour le mirror cote front (src/lib/gamification.ts).

// Publication d'une degustation (base).
export const XP_PER_TASTING = 10;
// Bonus qualite a la creation : lieu / notes longues / aromas detailles.
export const XP_BONUS_PLACE = 5;
export const XP_BONUS_LONG_NOTES = 5;
export const XP_BONUS_AROMAS = 3;
// Limites pour declencher les bonus qualite.
export const LONG_NOTES_THRESHOLD = 50;
export const MIN_AROMAS_FOR_BONUS = 3;
// Photos additionnelles (2eme et + sur une degustation).
export const XP_PER_PHOTO_ADDITIONAL = 2;
// Engagement recu (passif).
export const XP_PER_LIKE_RECEIVED = 1;
export const XP_PER_FOLLOWER = 5;
// Milestones one-shot.
export const XP_FIRST_TASTING = 25;
export const XP_FIRST_FOLLOWER = 20;
export const XP_ONBOARDING = 50;
export const XP_PROFILE_COMPLETE = 25;
export const STREAK_MILESTONES: Record<number, number> = {
  7: 50,
  30: 200,
  100: 1000,
};

// --- Grades par tranche de niveau ---
// Les paliers de progression sont desormais persistes en BDD via le modele
// Grade et le service grade.service.ts (seed + cache memoire). On reexpose
// ici juste la constante MAX_LEVEL pour le front (mirror manuel).
export const MAX_LEVEL = 100;

// Formule level : palier sqrt accelerant naturellement
//   xp 0-99    -> level 1
//   xp 100-399 -> level 2
//   xp 400-899 -> level 3
//   xp 900-1599 -> level 4
//   xp 1600+   -> level 5+
// Avantage : facile a expliquer, recompense la duree sans devenir trivial.
function computeLevel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

// Normalise une date a minuit local pour comparer "meme jour" sans heure.
// Utilise le fuseau du serveur — acceptable pour MVP, on raffinera avec le
// timezone user si besoin (le streak peut etre rate de quelques heures
// quand on chevauche minuit).
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Calcule l'etat du streak apres une activite "aujourd'hui".
// - Premiere activite : current = 1
// - Meme jour qu'une activite precedente : pas de change (deja compte)
// - Jour J+1 (consecutif) : current += 1
// - Plus loin (gap) : reset a 1
function computeNextStreak(
  currentStreak: number,
  longestStreak: number,
  lastActiveAt: Date | null | undefined,
  now: Date,
): { current: number; longest: number } {
  if (!lastActiveAt) return { current: 1, longest: Math.max(1, longestStreak) };
  const last = startOfDay(new Date(lastActiveAt));
  const today = startOfDay(now);
  const diffDays = Math.round((today.getTime() - last.getTime()) / 86_400_000);
  let nextCurrent: number;
  if (diffDays <= 0) nextCurrent = Math.max(1, currentStreak);
  else if (diffDays === 1) nextCurrent = currentStreak + 1;
  else nextCurrent = 1;
  return {
    current: nextCurrent,
    longest: Math.max(longestStreak, nextCurrent),
  };
}

// Helper bas-niveau : ajoute `amount` XP a un user et recalcule son level
// + son grade (persiste en BDD pour pouvoir querier par grade plus tard).
// Idempotent : amount <= 0 retourne sans toucher la DB. Reutilisable par tous
// les hooks XP (like, follow, photo, milestones).
export async function grantXp(userId: Types.ObjectId, amount: number): Promise<void> {
  if (amount <= 0) return;
  const user = await UserModel.findById(userId).select('gamification.xp');
  if (!user) return;
  const nextXp = (user.gamification?.xp ?? 0) + amount;
  const nextLevel = computeLevel(nextXp);
  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        'gamification.xp': nextXp,
        'gamification.level': nextLevel,
        'gamification.grade': getGradeForLevel(nextLevel).key,
      },
    },
  );
}

// Helper bas-niveau : ajuste l'XP d'un delta arbitraire (positif ou negatif),
// clamp a 0 minimum. Recalcule level + grade. Reserve aux usages admin et
// aux corrections de stock (ex: degustation supprimee plus tard).
export async function adjustXp(userId: Types.ObjectId, delta: number): Promise<{ xp: number; level: number; grade: string }> {
  const user = await UserModel.findById(userId).select('gamification.xp');
  if (!user) throw AppError.notFound('Utilisateur introuvable');
  const currentXp = user.gamification?.xp ?? 0;
  const nextXp = Math.max(0, currentXp + delta);
  const nextLevel = computeLevel(nextXp);
  const nextGrade = getGradeForLevel(nextLevel).key;
  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        'gamification.xp': nextXp,
        'gamification.level': nextLevel,
        'gamification.grade': nextGrade,
      },
    },
  );
  return { xp: nextXp, level: nextLevel, grade: nextGrade };
}

// Force la valeur absolue d'XP d'un user. Clamp a 0 minimum. Recalcule
// level + grade. Reserve aux usages admin (reset / set explicit).
export async function setXp(userId: Types.ObjectId, xp: number): Promise<{ xp: number; level: number; grade: string }> {
  const nextXp = Math.max(0, xp);
  const nextLevel = computeLevel(nextXp);
  const nextGrade = getGradeForLevel(nextLevel).key;
  const result = await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        'gamification.xp': nextXp,
        'gamification.level': nextLevel,
        'gamification.grade': nextGrade,
      },
    },
  );
  if (result.matchedCount === 0) throw AppError.notFound('Utilisateur introuvable');
  return { xp: nextXp, level: nextLevel, grade: nextGrade };
}

// Selectionne le grade d'affichage (override visuel) pour un user. Le user
// ne peut choisir qu'un grade qu'il a deja debloque (level >= minLevel du
// grade). Passer null reset a l'affichage auto (grade derive du level).
export async function setDisplayGrade(user: UserDoc, key: string | null): Promise<UserDoc> {
  if (key === null) {
    user.gamification!.displayGrade = null;
    await user.save();
    return user;
  }
  // Lecture cache memoire (grade.service) : aucun cout BDD.
  const grade = getGradeByKeyCached(key);
  if (!grade) throw AppError.badRequest('Grade inconnu');
  const currentLevel = user.gamification?.level ?? 1;
  if (currentLevel < grade.minLevel) {
    throw AppError.forbidden('Grade non debloque');
  }
  user.gamification!.displayGrade = key;
  await user.save();
  return user;
}

// Recompense un user pour la publication d'une degustation : +XP, recalc du
// level, update du streak + bonus de milestones streak (7/30/100 jours).
// `baseXp` peut etre customise par l'appelant (createTasting calcule bonus
// qualite et l'envoie ici en parametre).
// Atomicite : read-then-write (acceptable MVP, un user ne publie pas deux
// degustations simultanees).
export async function awardTastingXp(
  userId: Types.ObjectId,
  baseXp: number = XP_PER_TASTING,
): Promise<void> {
  const user = await UserModel.findById(userId).select('gamification');
  if (!user) return;

  const now = new Date();
  const prevStreak = user.gamification?.streak?.current ?? 0;
  const streak = computeNextStreak(
    prevStreak,
    user.gamification?.streak?.longest ?? 0,
    user.gamification?.streak?.lastActiveAt,
    now,
  );

  // Bonus milestones streak : si on franchit 7, 30 ou 100 jours pour la
  // 1ere fois (verifie via bonusesGranted), on ajoute le bonus correspondant.
  let milestoneBonus = 0;
  const milestoneFlags: Record<string, boolean> = {};
  const already = user.gamification?.bonusesGranted ?? { streak7: false, streak30: false, streak100: false };
  for (const threshold of [7, 30, 100] as const) {
    const flagKey = `streak${threshold}` as 'streak7' | 'streak30' | 'streak100';
    if (
      !already[flagKey] &&
      prevStreak < threshold &&
      streak.current >= threshold
    ) {
      milestoneBonus += STREAK_MILESTONES[threshold];
      milestoneFlags[`gamification.bonusesGranted.${flagKey}`] = true;
    }
  }

  const nextXp = (user.gamification?.xp ?? 0) + baseXp + milestoneBonus;
  const nextLevel = computeLevel(nextXp);

  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        'gamification.xp': nextXp,
        'gamification.level': nextLevel,
        'gamification.grade': getGradeForLevel(nextLevel).key,
        'gamification.streak.current': streak.current,
        'gamification.streak.longest': streak.longest,
        'gamification.streak.lastActiveAt': now,
        ...milestoneFlags,
      },
    },
  );
}

// Profil "complet" : avatar + bio + location.city renseignes. Award one-shot
// +XP la 1ere fois que la condition devient vraie. A appeler apres tout
// changement de profil (updateMe, uploadAvatar).
export async function tryGrantProfileCompleteBonus(user: UserDoc): Promise<void> {
  if (user.gamification?.bonusesGranted?.profileComplete) return;
  const hasAvatar = !!user.avatarUrl;
  const hasBio = !!user.bio?.trim();
  const hasLocation = !!user.location?.city?.trim();
  if (!hasAvatar || !hasBio || !hasLocation) return;
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        'gamification.bonusesGranted.profileComplete': true,
      },
      $inc: {
        // Inc atomique pour eviter une race avec d'autres grants concurrents.
        // Level sera reconcilie au prochain grantXp / awardTastingXp.
        'gamification.xp': XP_PROFILE_COMPLETE,
      },
    },
  );
  // Recalc level + grade apres l'inc.
  const fresh = await UserModel.findById(user._id).select('gamification.xp');
  if (fresh) {
    const lvl = computeLevel(fresh.gamification?.xp ?? 0);
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          'gamification.level': lvl,
          'gamification.grade': getGradeForLevel(lvl).key,
        },
      },
    );
  }
}

// --- Helpers exposes au tasting.service pour stats denormalisees ---

export async function incrementTastingStats(userId: Types.ObjectId, category: string): Promise<void> {
  await UserModel.updateOne(
    { _id: userId },
    {
      $inc: {
        'stats.tastingsCount': 1,
        [`stats.tastingsByCategory.${category}`]: 1,
      },
    },
  );
}

export async function decrementTastingStats(userId: Types.ObjectId, category: string): Promise<void> {
  await UserModel.updateOne(
    { _id: userId },
    {
      $inc: {
        'stats.tastingsCount': -1,
        [`stats.tastingsByCategory.${category}`]: -1,
      },
    },
  );
}
