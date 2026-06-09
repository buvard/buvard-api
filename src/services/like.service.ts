import type { Types } from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { LikeModel } from '../models/Like.js';
import { TastingModel } from '../models/Tasting.js';
import { BlockModel } from '../models/Block.js';
import type { UserDoc } from '../models/User.js';
import { grantXp, XP_PER_LIKE_RECEIVED } from './user.service.js';
import { isDuplicateKeyError } from '../utils/mongoErrors.js';
import { hasMorePages, pageSkip } from '../utils/pagination.js';
import { createNotification } from './notification.service.js';

// Verifie que le viewer peut liker (tasting existe + visible + pas de block entre viewer et auteur).
async function assertCanLike(userId: Types.ObjectId, tastingId: string): Promise<{ tastingObjectId: Types.ObjectId; authorId: Types.ObjectId }> {
  const tasting = await TastingModel.findOne({ _id: tastingId, deletedAt: null }).select('userId visibility');
  if (!tasting) throw AppError.notFound('Tasting introuvable');

  // Visibilite : si prive, seul le owner peut interagir (peu utile mais coherent).
  if (tasting.visibility === 'private' && !tasting.userId.equals(userId)) {
    throw AppError.forbidden();
  }

  // Block dans un sens ou l'autre = action impossible.
  const blocked = await BlockModel.exists({
    $or: [
      { blockerId: userId, blockedId: tasting.userId },
      { blockerId: tasting.userId, blockedId: userId },
    ],
  });
  if (blocked) throw AppError.forbidden('Action impossible suite a un blocage');

  return { tastingObjectId: tasting._id, authorId: tasting.userId };
}

// Like idempotent. Retourne { liked: true, likesCount } meme si deja like.
export async function likeTasting(user: UserDoc, tastingId: string): Promise<{ liked: true; likesCount: number }> {
  const { tastingObjectId, authorId } = await assertCanLike(user._id, tastingId);

  try {
    await LikeModel.create({ userId: user._id, tastingId: tastingObjectId });
    // Incrementation atomique du compteur uniquement si l'insert a reussi
    // (pas deja like).
    const updated = await TastingModel.findByIdAndUpdate(
      tastingObjectId,
      { $inc: { likesCount: 1 } },
      { new: true, projection: { likesCount: 1 } },
    );
    // Bonus XP + notif au proprietaire du tasting (pas d'auto-like). La notif
    // n'est creee qu'ici, donc une seule fois par like (pas de spam si
    // like/unlike/like). Non bloquant.
    if (!authorId.equals(user._id)) {
      await grantXp(authorId, XP_PER_LIKE_RECEIVED);
      void createNotification({
        userId: authorId,
        actorId: user._id,
        type: 'like',
        tastingId: tastingObjectId,
      });
    }
    return { liked: true, likesCount: updated?.likesCount ?? 0 };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Deja like, on retourne juste le compteur courant.
      const tasting = await TastingModel.findById(tastingObjectId).select('likesCount');
      return { liked: true, likesCount: tasting?.likesCount ?? 0 };
    }
    throw err;
  }
}

// Unlike idempotent. Retourne { liked: false, likesCount }.
export async function unlikeTasting(user: UserDoc, tastingId: string): Promise<{ liked: false; likesCount: number }> {
  const tasting = await TastingModel.findOne({ _id: tastingId, deletedAt: null }).select('_id');
  if (!tasting) throw AppError.notFound('Tasting introuvable');

  const result = await LikeModel.deleteOne({ userId: user._id, tastingId: tasting._id });
  if (result.deletedCount > 0) {
    const updated = await TastingModel.findByIdAndUpdate(
      tasting._id,
      { $inc: { likesCount: -1 } },
      { new: true, projection: { likesCount: 1 } },
    );
    return { liked: false, likesCount: Math.max(0, updated?.likesCount ?? 0) };
  }
  const fresh = await TastingModel.findById(tasting._id).select('likesCount');
  return { liked: false, likesCount: fresh?.likesCount ?? 0 };
}

// Pour un viewer connecte, resout les ids des tastings qu'il a like parmi
// la liste donnee. Sert a annoter les listings avec isLikedByMe.
export async function getLikedTastingIds(
  viewerId: Types.ObjectId,
  tastingIds: Types.ObjectId[],
): Promise<Set<string>> {
  if (tastingIds.length === 0) return new Set();
  const likes = await LikeModel.find({
    userId: viewerId,
    tastingId: { $in: tastingIds },
  }).select('tastingId');
  return new Set(likes.map((l) => l.tastingId.toString()));
}

// Liste paginee des users qui ont like un tasting. Plus recent en premier.
// On peuple les infos minimales du user pour eviter un N+1 cote front.
export interface LikerListItem {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  likedAt: Date;
}

export interface PaginatedLikers {
  data: LikerListItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export async function listTastingLikers(
  tastingId: string,
  viewer: UserDoc | null,
  page: number,
  limit: number,
): Promise<PaginatedLikers> {
  // Verifie d'abord que le tasting existe et est visible pour le viewer.
  const tasting = await TastingModel.findOne({ _id: tastingId, deletedAt: null }).select(
    'userId visibility',
  );
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (tasting.visibility === 'private' && (!viewer || !tasting.userId.equals(viewer._id))) {
    throw AppError.forbidden();
  }

  const filter = { tastingId: tasting._id };
  const [likes, total] = await Promise.all([
    LikeModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(pageSkip(page, limit))
      .limit(limit)
      .populate('userId', 'username displayName avatarUrl deletedAt'),
    LikeModel.countDocuments(filter),
  ]);

  const data: LikerListItem[] = [];
  for (const like of likes) {
    const u = like.userId as unknown as {
      _id: Types.ObjectId;
      username?: string;
      displayName?: string | null;
      avatarUrl?: string | null;
      deletedAt?: Date | null;
    } | null;
    if (!u || !u.username || u.deletedAt) continue;
    data.push({
      id: String(u._id),
      username: u.username,
      displayName: u.displayName ?? undefined,
      avatarUrl: u.avatarUrl ?? undefined,
      likedAt: like.createdAt,
    });
  }

  return { data, page, limit, total, hasMore: hasMorePages(page, limit, total) };
}
