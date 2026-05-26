import { clerkClient } from '@clerk/express';
import type { Types } from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { TastingModel } from '../models/Tasting.js';
import { FollowModel } from '../models/Follow.js';
import { BlockModel } from '../models/Block.js';
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

// Genere un username unique a partir d'une base proposee par Clerk
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

interface ClerkUpsertPayload {
  clerkId: string;
  username: string | null;
  emailPrefix: string | null;
  fullName: string | null;
  imageUrl: string | null;
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
  clerkId: string;
  baseUsername: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// Cree un user en gerant les races (clerkId/username dupliques entre webhook et auth lazy)
async function createUserSafely(seed: CreateSeed): Promise<UserDoc> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const username = await ensureUniqueUsername(seed.baseUsername);
    try {
      return await UserModel.create({
        clerkId: seed.clerkId,
        username,
        displayName: seed.displayName || username,
        avatarUrl: seed.avatarUrl || undefined,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Dupe sur clerkId: un autre process (webhook ou auth) a deja insere ce user
      const byClerk = await UserModel.findOne({ clerkId: seed.clerkId });
      if (byClerk) return reviveIfDeleted(byClerk);
      // Sinon dupe sur username: on retry avec un nouveau candidat
    }
  }
  throw AppError.conflict('Impossible de creer le user, conflit persistant');
}

export async function findOrCreateUserFromClerk(clerkId: string): Promise<UserDoc> {
  const existing = await UserModel.findOne({ clerkId });
  if (existing) {
    const revived = await reviveIfDeleted(existing);
    await touchLastSeen(revived);
    return revived;
  }

  const clerkUser = await clerkClient.users.getUser(clerkId);
  const primaryEmail = clerkUser.emailAddresses[0]?.emailAddress ?? null;
  const emailPrefix = primaryEmail ? (primaryEmail.split('@')[0] ?? null) : null;
  const baseUsername = clerkUser.username || emailPrefix || `user_${clerkId.slice(-6)}`;
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;

  return createUserSafely({
    clerkId,
    baseUsername,
    displayName: fullName,
    avatarUrl: clerkUser.imageUrl || null,
  });
}

export async function upsertUserFromWebhook(payload: ClerkUpsertPayload): Promise<UserDoc> {
  const existing = await UserModel.findOne({ clerkId: payload.clerkId });
  if (existing) {
    if (payload.fullName) existing.displayName = payload.fullName;
    if (payload.imageUrl) existing.avatarUrl = payload.imageUrl;
    if (existing.deletedAt) existing.deletedAt = null;
    await existing.save();
    return existing;
  }
  const baseUsername = payload.username || payload.emailPrefix || `user_${payload.clerkId.slice(-6)}`;
  return createUserSafely({
    clerkId: payload.clerkId,
    baseUsername,
    displayName: payload.fullName,
    avatarUrl: payload.imageUrl,
  });
}

export async function softDeleteUserByClerkId(clerkId: string): Promise<void> {
  await UserModel.updateOne({ clerkId }, { $set: { deletedAt: new Date() } });
}

export async function softDeleteMe(user: UserDoc): Promise<void> {
  user.deletedAt = new Date();
  await user.save();
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
  if (input.bio !== undefined) user.bio = input.bio;
  if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
  if (input.coverUrl !== undefined) user.coverUrl = input.coverUrl;
  if (input.birthYear !== undefined) user.birthYear = input.birthYear;
  if (input.favoriteCategories !== undefined) user.favoriteCategories = input.favoriteCategories;
  if (input.location !== undefined) {
    user.location = {
      country: input.location.country,
      city: input.location.city,
    };
  }
  await user.save();
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
    gamification: user.gamification ?? { xp: 0, level: 1, streak: { current: 0, longest: 0, lastActiveAt: null } },
    joinDate: user.createdAt,
  };
}

// --- Onboarding & legal ---

export async function completeOnboarding(user: UserDoc): Promise<UserDoc> {
  if (!user.onboardingCompletedAt) {
    user.onboardingCompletedAt = new Date();
    await user.save();
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
  const users = await UserModel.find({ _id: { $in: ids } }).select('username displayName avatarUrl bio');
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
